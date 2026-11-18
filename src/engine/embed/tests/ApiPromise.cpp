#include "ApiFixtures.h"

using namespace JSC;
using Test::Realm;

static JSFunction* logger(Realm& realm, ASCIILiteral name)
{
    return realm.function([&realm, name](JSGlobalObject*, CallFrame* frame) {
        StringBuilder entry;
        entry.append(name);
        for (size_t i = 0; i < frame->argumentCount(); ++i)
            entry.append(' ', realm.text(frame->argument(i)));
        Realm::log(entry.toString());
        return JSValue::encode(jsNumber(7));
    });
}

TEST(PromiseState)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* promise = JSPromise::create(vm, realm.global->promiseStructure());
    EXPECT(promise->status() == JSPromise::Status::Pending && promise->result().isUndefined() && !promise->isHandled());
    promise->resolve(realm.global, vm, jsNumber(1));
    promise->resolve(realm.global, vm, jsNumber(2));
    promise->reject(vm, jsNumber(3));
    EXPECT(promise->status() == JSPromise::Status::Fulfilled && promise->result() == jsNumber(1));
    EXPECT(promise->flags() & JSPromise::isFirstResolvingFunctionCalledFlag);
    EXPECT(JSPromise::resolvedPromise(realm.global, promise) == promise);

    auto* rejected = JSPromise::rejectedPromise(realm.global, jsNumber(4));
    EXPECT(rejected->status() == JSPromise::Status::Rejected && rejected->settlementValue() == jsNumber(4));
    rejected->then(realm.global, jsUndefined(), logger(realm, "caught"_s));
    EXPECT(rejected->isHandled());
    JSPromise::create(vm, realm.global->promiseStructure())->rejectAsHandled(vm, jsNumber(5));
    vm.drainMicrotasks();
    EXPECT(Realm::takeLog() == "reject, handle, caught 4"_s);

    auto* settledByHand = JSPromise::create(vm, realm.global->promiseStructure());
    settledByHand->setFlags(static_cast<uint16_t>(JSPromise::Status::Fulfilled));
    settledByHand->setSlot(vm, realm.run("'by hand'"_s));
    realm.define("settledByHand"_s, settledByHand);
    realm.run("settledByHand.then(value => globalThis.seen = value)"_s);
    vm.drainMicrotasks();
    EXPECT(realm.text(realm.run("seen"_s)) == "by hand"_s);
}

TEST(PromiseFlagsLeaveReactionsAlone)
{
    Realm realm;
    auto* promise = uncheckedDowncast<JSPromise>(realm.run("var resolve, promise = new Promise(it => resolve = it); promise.then(it => globalThis.first = it); promise"_s));
    promise->markAsHandled();
    promise->setFlags(promise->flags() | JSPromise::isHandledFlag);
    realm.collect();
    realm.run("promise.then(it => globalThis.second = it); resolve(1)"_s);
    realm.vm.drainMicrotasks();
    EXPECT(realm.run("first + second"_s) == jsNumber(2));
}

TEST(PromiseTakesException)
{
    Realm realm;
    auto& vm = realm.vm;
    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        throwTypeError(realm.global, scope, "first"_s);
        auto* promise = JSPromise::rejectedPromiseWithCaughtException(realm.global, scope);
        EXPECT(realm.text(promise->result()) == "TypeError: first"_s);
    }
    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        auto* promise = JSPromise::create(vm, realm.global->promiseStructure());
        throwTypeError(realm.global, scope, "second"_s);
        EXPECT(promise->rejectWithCaughtException(vm, scope) == promise);
        EXPECT(realm.text(promise->result()) == "TypeError: second"_s);
    }
    {
        auto scope = DECLARE_THROW_SCOPE(vm);
        vm.setHasTerminationRequest();
        vm.throwTerminationException();
        EXPECT(!JSPromise::rejectedPromiseWithCaughtException(realm.global, scope));
        EXPECT(vm.hasPendingTerminationException());
        vm.cancelTermination();
    }
}

TEST(PromiseReactions)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* source = JSPromise::create(vm, global->promiseStructure());
    auto* result = JSPromise::create(vm, global->promiseStructure());
    auto* piped = JSPromise::create(vm, global->promiseStructure());
    source->performPromiseThenWithContext(vm, global, logger(realm, "with"_s), jsUndefined(), result, jsNumber(9));
    source->performPromiseThenWithContext(vm, global, logger(realm, "null"_s), jsUndefined(), jsUndefined(), jsNull());
    source->performPromiseThen(vm, global, logger(realm, "without"_s), jsUndefined(), jsUndefined());
    piped->pipeFrom(vm, source);
    realm.define("resolve"_s, source->createFirstResolveFunction(vm, global));
    realm.collect();
    realm.run("resolve(1); resolve(2)"_s);
    vm.drainMicrotasks();
    EXPECT(Realm::takeLog() == "with 1 9, null 1, without 1"_s);
    EXPECT(result->result() == jsNumber(7) && piped->result() == jsNumber(1));

    EXPECT(source->isThenFastAndNonObservable());
    EXPECT(!uncheckedDowncast<JSPromise>(realm.run("new (class extends Promise { then() {} })(() => {})"_s))->isThenFastAndNonObservable());

    realm.define("capability"_s, JSPromise::createNewPromiseCapability(global, global->promiseConstructor()));
    EXPECT(realm.run("capability.promise instanceof Promise && typeof capability.resolve + typeof capability.reject == 'functionfunction'"_s).isTrue());
    EXPECT(!JSPromise::createNewPromiseCapability(global, jsNumber(1)));
    EXPECT(realm.takeException() == "TypeError: argument is not a constructor"_s);
}

TEST(Microtasks)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    vm.deferredWorkTimer->onSetTimer = [](auto) {};
    vm.deferredWorkTimer->start(vm);
    JSValue thrower = realm.run("() => { throw 'it' }"_s);
    vm.queueMicrotask({ nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, global, logger(realm, "a"_s), jsUndefined() });
    vm.queueMicrotask({ nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, global, logger(realm, "b"_s), jsUndefined(), jsNumber(1), jsNumber(2) });
    vm.queueMicrotask({ nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, global, thrower, jsUndefined() });
    vm.queueMicrotask({ nullptr, InternalMicrotask::BunInvokeJobWithArguments, 0, global, logger(realm, "c"_s), jsNumber(1), jsNumber(2), jsNumber(3) });
    vm.queueMicrotask({ nullptr, InternalMicrotask::BunInvokeJobWithArguments, 0, global, thrower });
    vm.setOnEachMicrotaskTick([](VM& vm) {
        Realm::log("tick"_s);
        vm.setOnEachMicrotaskTick(nullptr);
    });
    realm.collect();
    vm.drainMicrotasks();
    EXPECT(Realm::takeLog() == "a, tick, b 1 2, error of microtask it, c 1 2 3, uncaught it"_s);

    vm.queueMicrotask({ nullptr, InternalMicrotask::BunInvokeJobWithArguments, 0, global, logger(realm, "cleared"_s) });
    vm.defaultMicrotaskQueue().clear();
    vm.queueMicrotask({ nullptr, InternalMicrotask::BunInvokeJobWithArguments, 0, global, logger(realm, "discarded"_s) });
    global->setMicrotaskRunnability(QueuedTaskResult::Discard);
    EXPECT(global->microtaskRunnability() == QueuedTaskResult::Discard);
    vm.drainMicrotasks();
    EXPECT(Realm::takeLog().isEmpty());
}

TEST(MicrotasksOfRealm)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* other = realm.createGlobalObject();
    EXPECT(&other->microtaskQueue() == &vm.defaultMicrotaskQueue());
    other->setMicrotaskQueue(MicrotaskQueue::create(vm));
    JSPromise::resolvedPromise(other, jsNumber(1))->performPromiseThen(vm, other, logger(realm, "other"_s), jsUndefined(), jsUndefined());
    realm.collect();
    vm.drainMicrotasks();
    EXPECT(Realm::takeLog().isEmpty());
    other->microtaskQueue().performMicrotaskCheckpoint(vm);
    EXPECT(Realm::takeLog() == "other 1"_s);

    EXPECT(!vm.synchronousModuleQueue());
    {
        VM::SynchronousModuleQueueScope queue(vm);
        EXPECT(vm.synchronousModuleQueue());
    }
    EXPECT(!vm.synchronousModuleQueue());
}

TEST(AsyncContext)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* holder = global->m_asyncContextData.get();
    auto* report = realm.function([&](JSGlobalObject*, CallFrame* frame) {
        Realm::log(makeString(realm.text(holder->getInternalField(0)), ' ', realm.text(frame->argument(1))));
        return JSValue::encode(jsUndefined());
    });
    EXPECT(!global->isAsyncContextTrackingEnabled());
    global->setAsyncContextTrackingEnabled(true);
    auto* promise = JSPromise::create(vm, global->promiseStructure());
    holder->putInternalField(vm, 0, jsNumber(1));
    promise->performPromiseThenWithContext(vm, global, report, jsUndefined(), jsUndefined(), jsNumber(10));
    holder->putInternalField(vm, 0, jsNumber(2));
    promise->performPromiseThenWithContext(vm, global, report, jsUndefined(), JSPromise::create(vm, global->promiseStructure()), jsNumber(20));
    holder->putInternalField(vm, 0, jsUndefined());
    promise->fulfill(vm, jsUndefined());
    vm.queueMicrotask({ nullptr, InternalMicrotask::BunPerformMicrotaskJob, 0, global, report, jsNumber(3), jsUndefined(), jsNumber(30) });
    vm.drainMicrotasks();
    EXPECT(Realm::takeLog() == "1 10, 2 20, 3 30"_s);
    EXPECT(holder->getInternalField(0).isUndefined());
}

struct EventLoop {
    using Ticket = DeferredWorkTimer::Ticket;

    explicit EventLoop(VM& vm)
    {
        auto& hooks = vm.deferredWorkTimer.get();
        hooks.onAddPendingWork = [this](Ref<Ticket>&& ticket, auto type) {
            isImminent = type == DeferredWorkTimer::WorkType::ImminentlyScheduled;
            pending.append(WTF::move(ticket));
        };
        hooks.onScheduleWorkSoon = [this](Ref<Ticket>&& ticket, auto&& task) { tasks.append({ WTF::move(ticket), WTF::move(task) }); };
        hooks.onCancelPendingWork = [this](Ticket& ticket) { pending.removeAllMatching([&](auto& it) { return it.ptr() == &ticket; }); };
        hooks.onSetTimer = [this](auto newDelay) { delay = newDelay; };
        hooks.start(vm);
    }

    Vector<Ref<Ticket>> pending;
    Vector<std::pair<Ref<Ticket>, DeferredWorkTimer::Task>> tasks;
    std::optional<Seconds> delay;
    bool isImminent { false };
};

TEST(DeferredWork)
{
    std::optional<EventLoop> loop;
    Realm realm;
    auto& vm = realm.vm;
    loop.emplace(vm);
    auto* promise = uncheckedDowncast<JSPromise>(realm.run("var words = new Int32Array(new SharedArrayBuffer(8)); Atomics.waitAsync(words, 0, 0).value"_s));
    EXPECT(loop->pending.size() == 1 && !loop->isImminent && loop->tasks.isEmpty());
    EXPECT(loop->pending[0]->target() == promise && loop->pending[0]->scriptExecutionOwner() == realm.global);
    realm.run("Atomics.notify(words, 0)"_s);
    EXPECT(loop->tasks.size() == 1 && promise->status() == JSPromise::Status::Pending);
    auto [ticket, task] = loop->tasks.takeLast();
    EXPECT(!ticket->isCancelled());
    task(ticket.get());
    EXPECT(realm.text(promise->result()) == "ok"_s);
    loop->pending.clear();

    promise = uncheckedDowncast<JSPromise>(realm.run("Atomics.waitAsync(words, 0, 0, 1).value"_s));
    EXPECT(loop->delay && *loop->delay <= 1_ms);
    while (loop->tasks.isEmpty())
        vm.deferredWorkTimer->runDueTimers(vm);
    loop->tasks.last().second(loop->tasks.last().first.get());
    EXPECT(realm.text(promise->result()) == "timed-out"_s);

    // One task is dropped without having run, and one ticket is still pending when the VM goes.
    realm.run("Atomics.waitAsync(words, 0, 0); Atomics.notify(words, 0); Atomics.waitAsync(words, 1, 0)"_s);
    loop->tasks.clear();
}
