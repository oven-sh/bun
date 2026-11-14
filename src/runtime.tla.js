// Top-level await in a bundle. See src/bundler/linker_context/tlaPlan.rs. Part of the bundler's runtime module only
// (ParseTask.rs appends it to runtime.js).
//
// A module that can be asynchronous has a record:
//   f body, t [[HasTLA]], i what its `import` statements do (only for __tlaModule),
//   s [[Status]] 0 linked / 1 evaluating / 2 evaluating-async / 3 evaluated / 4 evaluated with the error e,
//   o [[AsyncEvaluationOrder]] (-1 unset), n [[PendingAsyncDependencies]], p [[AsyncParentModules]],
//   r [[CycleRoot]] (0 empty), c [[TopLevelCapability]] as [resolve, reject, promise], d [[DFSAncestorIndex]]
var __tlaOrder = 0;
var __tlaRecord = (f, t, i) => ({ f, t, i, s: 0, o: -1, n: 0, p: [], r: 0, e: 0, c: 0, d: 0 });
// Runs the body, which is not needed again.
var __tlaBody = (m, f) => ((f = m.f), (m.f = m.i = 0), f());
// ExecuteAsyncModule
var __tlaExecute = m => {
  __tlaStarting = m;
  __tlaBody(m).then(
    () => __tlaFulfilled(m),
    e => __tlaRejected(m, e),
  );
};
// GatherAvailableAncestors
var __tlaGather = (m, list) => {
  for (var a of m.p)
    if (a.r && a.r.s < 4 && !--a.n) {
      list.push(a);
      a.t || __tlaGather(a, list);
    }
};
// AsyncModuleExecutionFulfilled
var __tlaFulfilled = (m, list) => {
  if (m.s > 2) return;
  m.s = 3;
  m.c && m.c[0]();
  __tlaGather(m, (list = []));
  for (var a of list.sort((a, b) => a.o - b.o))
    if (a.s > 2);
    else if (a.t) __tlaExecute(a);
    else
      try {
        __tlaBody(a);
        a.s = 3;
        a.c && a.c[0]();
      } catch (e) {
        __tlaRejected(a, e);
      }
};
// AsyncModuleExecutionRejected
var __tlaRejected = (m, e) => {
  if (m.s > 2) return;
  m.s = 4;
  m.e = e;
  m.c && m.c[1](e);
  for (var a of m.p) __tlaRejected(a, e);
};
// The steps of InnerModuleEvaluation for one requested module `q` of `m`, once `q` was visited.
var __tlaRequested = (m, q) => {
  if (q.s == 1) m.d = Math.min(m.d, q.d);
  else if ((q = q.r || q).s > 3) throw q.e;
  if (q.o >= 0 && q.s < 3 && q.o != __tlaReferrerOrder) {
    m.n++;
    q.p.push(m);
  }
};
// As in Bun's module loader: what an `import()` loads does not wait for the module that the `import()` is written
// in. That module can be waiting for the `import()`.
var __tlaReferrerOrder = -1;
// The steps of InnerModuleEvaluation behind the loop over the requested modules.
var __tlaLeave = m => {
  if (m.t || m.n) {
    m.o = __tlaOrder++;
    m.n || __tlaExecute(m);
  } else __tlaBody(m);
};

// A module that only the entry point's own `import` statements reach. The linker did the walk of
// InnerModuleEvaluation: this call is printed where the walk leaves the module, `deps` are the modules it waits
// for, `open` says that the walk is still inside an import cycle, and `members` are the modules of the cycle that
// the walk leaves here.
export var __tlaNode = (f, t, deps, open, members, m) => {
  m = __tlaRecord(f, t);
  m.s = 2;
  __tlaRunning += t;
  for (var d of deps) __tlaRequested(m, d);
  __tlaLeave(m);
  if (m.o < 0) m.s = 3;
  if (!open) m.r = m;
  if (members) for (var x of members) x.r = m;
  return m;
};
// The entry point has already run when tree shaking removed every module that it would have waited for.
export var __tlaWait = m => m.s < 3 && new Promise((resolve, reject) => (m.c = [resolve, reject]));

// An entry point that stays on the chunk's top level. It waits for every __tlaNode, so it is the last module of the
// last __tlaFulfilled. Every body with an `await` ends with __tlaDone. The last of them wakes the top level, which
// queues its continuation right ahead of the job that the end of that body queues for __tlaFulfilled. The
// continuation (__tlaResume) makes that call itself and goes on into the entry point's code, so the entry point runs in
// the promise job in which it would have run, and the job that was overtaken finds nothing left to do.
var __tlaRunning = 0;
var __tlaStarting;
var __tlaLast;
var __tlaWake;
var __tlaEntry;
// `m` is not assigned yet if the body ends inside the call that starts it.
export var __tlaDone = m => {
  --__tlaRunning || ((__tlaLast = m || __tlaStarting), __tlaWake && __tlaWake());
};
export var __tlaMain = deps =>
  new Promise(wake => {
    __tlaWake = wake;
    __tlaEntry = __tlaNode(() => {}, 0, deps);
    __tlaEntry.c = [wake, wake];
    __tlaRunning || wake();
  });
export var __tlaResume = () => {
  __tlaEntry.s > 2 || __tlaFulfilled(__tlaLast);
  if (__tlaEntry.s > 3) throw __tlaEntry.e;
};

// A module that `import()` reaches can run at any time, so it takes the walk at run time.
export var __tlaModule = __tlaRecord;
var __tlaStack = [];
var __tlaIndex = 0;
var __tlaCurrent;
// InnerModuleEvaluation
var __tlaInner = (m, index, parent, q) => {
  if (m.s > 3) throw m.e;
  if (m.s) return;
  m.s = 1;
  index = m.d = __tlaIndex++;
  __tlaStack.push(m);
  parent = __tlaCurrent;
  __tlaCurrent = m;
  m.i();
  __tlaCurrent = parent;
  __tlaLeave(m);
  if (m.d == index)
    do {
      q = __tlaStack.pop();
      q.s = q.o < 0 ? 3 : 2;
      q.r = m;
    } while (q != m);
};
// An `import` statement in a __tlaModule.
export var __tlaVisit = (q, m) => {
  m = __tlaCurrent;
  __tlaInner(q);
  __tlaRequested(m, q);
};
// An `import` statement of a __tlaModule anywhere else, and what Evaluate does with an abrupt completion.
export var __tlaTop = m => {
  try {
    __tlaInner(m);
  } catch (e) {
    for (var q of __tlaStack) {
      q.s = 4;
      q.e = e;
    }
    __tlaStack = [];
    __tlaCurrent = 0;
    throw e;
  }
};
// Evaluate
export var __tlaEvaluate = (m, referrerOrder) => {
  if (m.s > 1 && m.r) m = m.r;
  if (!m.c) {
    m.c = [];
    m.c[2] = new Promise((resolve, reject) => {
      m.c[0] = resolve;
      m.c[1] = reject;
    });
    __tlaReferrerOrder = referrerOrder ?? -1;
    try {
      __tlaTop(m);
      m.s == 3 && m.c[0]();
    } catch (e) {
      m.c[1](e);
    }
    __tlaReferrerOrder = -1;
  }
  return m.c[2];
};
// ContinueDynamicImport
export var __tlaImport = (m, referrer, namespace) =>
  new Promise((resolve, reject) => {
    referrer = referrer && referrer.s < 3 ? referrer.o : -1;
    Promise.resolve().then(() => {
      __tlaEvaluate(m, referrer).then(() => resolve(namespace && namespace()), reject);
    });
  });
