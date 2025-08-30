# Understanding Document Object Model

## Introduction

[Document Object Model](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model)
(often abbreviated as DOM) is the tree data structured resulted from parsing HTML.
It consists of one or more instances of subclasses of [Node](https://developer.mozilla.org/en-US/docs/Web/API/Node)
and represents the document tree structure. Parsing a simple HTML like this:

```cpp
<!DOCTYPE html>
<html>
<body>hi</body>
</html>
```

Will generate the following six distinct DOM nodes:

* [Document](https://developer.mozilla.org/en-US/docs/Web/API/Document)
    * [DocumentType](https://developer.mozilla.org/en-US/docs/Web/API/DocumentType)
    * [HTMLHtmlElement](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/html)
        * [HTMLHeadElement](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/head)
        * [HTMLBodyElement](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/body)
            * [Text](https://developer.mozilla.org/en-US/docs/Web/API/Text) with the value of “hi”

Note that HTMLHeadElement (i.e. `<head>`) is created implicitly by WebKit
per the way [HTML parser](https://html.spec.whatwg.org/multipage/parsing.html#parsing) is specified.

Broadly speaking, DOM node divides into the following categories:

* [Container nodes](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ContainerNode.h) such as [Document](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.h), [Element](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Element.h), and [DocumentFragment](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DocumentFragment.h).
* Leaf nodes such as [DocumentType](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DocumentType.h), [Text](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Text.h), and [Attr](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Attr.h).

[Document](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.h) node,
as the name suggests a single HTML, SVG, MathML, or other XML document,
and is the [owner](https://github.com/WebKit/WebKit/blob/ea1a56ee11a26f292f3d2baed2a3aea95fea40f1/Source/WebCore/dom/Node.h#L359) of every node in the document.
It is the very first node in any document that gets created and the very last node to be destroyed.

Note that a single web [page](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Page.h) may consist of multiple documents
since [iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe)
and [object](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/object) elements may contain
a child [frame](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Frame.h),
and form a [frame tree](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/FrameTree.h).
Because JavaScript can [open a new window](https://developer.mozilla.org/en-US/docs/Web/API/Window/open)
under user gestures and have [access back to its opener](https://developer.mozilla.org/en-US/docs/Web/API/Window/opener),
multiple web pages across multiple tabs might be able to communicate with one another via JavaScript API
such as [postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

## JavaScript Wrappers and IDL files

In addition to typical C++ translation units (.cpp) and C++ header files (.cpp) along with some Objective-C and Objective-C++ files,
[WebCore](https://github.com/WebKit/WebKit/tree/main/Source/WebCore) contains hundreds of [Web IDL](https://webidl.spec.whatwg.org) (.idl) files.
[Web IDL](https://webidl.spec.whatwg.org) is an [interface description language](https://en.wikipedia.org/wiki/Interface_description_language)
and it's used to define the shape and the behavior of JavaScript API implemented in WebKit.

When building WebKit, a [perl script](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/scripts/CodeGeneratorJS.pm)
generates appropriate C++ translation units and C++ header files corresponding to these IDL files under `WebKitBuild/Debug/DerivedSources/WebCore/`
where `Debug` is the current build configuration (e.g. it could be `Release-iphonesimulator` for example).

These auto-generated files along with manually written files [Source/WebCore/bindings](https://github.com/WebKit/WebKit/tree/main/Source/WebCore/bindings)
are called **JS DOM binding code** and implements JavaScript API for objects and concepts whose underlying shape and behaviors are written in C++.

For example, C++ implementation of [Node](https://developer.mozilla.org/en-US/docs/Web/API/Node)
is [Node class](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Node.h)
and its JavaScript interface is implemented by `JSNode` class.
The class declaration and most of definitions are auto-generated
at `WebKitBuild/Debug/DerivedSources/WebCore/JSNode.h` and `WebKitBuild/Debug/DerivedSources/WebCore/JSNode.cpp` for debug builds.
It also has some custom, manually written, bindings code in
[Source/WebCore/bindings/js/JSNodeCustom.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/JSNodeCustom.cpp).
Similarly, C++ implementation of [Range interface](https://developer.mozilla.org/en-US/docs/Web/API/Range)
is [Range class](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Range.h)
whilst its JavaScript API is implemented by the auto-generated JSRange class
(located at `WebKitBuild/Debug/DerivedSources/WebCore/JSRange.h` and `WebKitBuild/Debug/DerivedSources/WebCore/JSRange.cpp` for debug builds)
We call instances of these JSX classes *JS wrappers* of X.

These JS wrappers exist in what we call a [`DOMWrapperWorld`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/DOMWrapperWorld.h).
Each `DOMWrapperWorld` has its own JS wrapper for each C++ object.
As a result, a single C++ object may have multiple JS wrappers in distinct `DOMWrapperWorld`s.
The most important `DOMWrapperWorld` is the main `DOMWrapperWorld` which runs the scripts of web pages WebKit loaded
while other `DOMWrapperWorld`s are typically used to run code for browser extensions and other code injected by applications that embed WebKit.
![Diagram of JS wrappers](resources/js-wrapper.png)
JSX.h provides `toJS` functions which creates a JS wrapper for X
in a given [global object](https://developer.mozilla.org/en-US/docs/Glossary/Global_object)’s `DOMWrapperWorld`,
and toWrapped function which returns the underlying C++ object.
For example, `toJS` function for [Node](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Node.h)
is defined in [Source/WebCore/bindings/js/JSNodeCustom.h](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/JSNodeCustom.h).

When there is already a JS wrapper object for a given C++ object,
`toJS` function will find the appropriate JS wrapper in
a [hash map](https://github.com/WebKit/WebKit/blob/ea1a56ee11a26f292f3d2baed2a3aea95fea40f1/Source/WebCore/bindings/js/DOMWrapperWorld.h#L74)
of the given `DOMWrapperWorld`.
Because a hash map lookup is expensive, some WebCore objects inherit from
[ScriptWrappable](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/ScriptWrappable.h),
which has an inline pointer to the JS wrapper for the main world if one was already created.

### Adding new JavaScript API

To introduce a new JavaScript API in [WebCore](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/), 
first identify the directory under which to implement this new API, and introduce corresponding Web IDL files (e.g., "dom/SomeAPI.idl").

New IDL files should be listed in [Source/WebCore/DerivedSources.make](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/DerivedSources.make)
so that the aforementioned perl script can generate corresponding JS*.cpp and JS*.h files.
Add these newly generated JS*.cpp files to [Source/WebCore/Sources.txt](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Sources.txt)
in order for them to be compiled.

Also, add the new IDL file(s) to [Source/WebCore/CMakeLists.txt](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/CMakeLists.txt).

Remember to add these files to [WebCore's Xcode project](https://github.com/WebKit/WebKit/tree/main/Source/WebCore/WebCore.xcodeproj) as well.

For example, [this commit](https://github.com/WebKit/WebKit/commit/cbda68a29beb3da90d19855882c5340ce06f1546)
introduced [`IdleDeadline.idl`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/IdleDeadline.idl)
and added `JSIdleDeadline.cpp` to the list of derived sources to be compiled.

## JS Wrapper Lifecycle Management

As a general rule, a JS wrapper keeps its underlying C++ object alive by means of reference counting
in [JSDOMWrapper](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/JSDOMWrapper.h) temple class
from which all JS wrappers in WebCore inherits.
However, **C++ objects do not keep their corresponding JS wrapper in each world alive** by the virtue of them staying alive
as such a circular dependency will result in a memory leak.

There are two primary mechanisms to keep JS wrappers alive in [WebCore](https://github.com/WebKit/WebKit/tree/main/Source/WebCore):

* **Visit Children** - When JavaScriptCore’s garbage collection visits some JS wrapper during
    the [marking phase](https://en.wikipedia.org/wiki/Tracing_garbage_collection#Basic_algorithm),
    visit another JS wrapper or JS object that needs to be kept alive.
* **Reachable from Opaque Roots** - Tell JavaScriptCore’s garbage collection that a JS wrapper is reachable
    from an opaque root which was added to the set of opaque roots during marking phase.

### Visit Children

*Visit Children* is the mechanism we use when a JS wrapper needs to keep another JS wrapper or
[JS object](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/JSObject.h) alive.

For example, [`ErrorEvent` object](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ErrorEvent.idl)
uses this method in
[Source/WebCore/bindings/js/JSErrorEventCustom.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/JSErrorEventCustom.cpp)
to keep its "error" IDL attribute as follows:

```cpp
template<typename Visitor>
void JSErrorEvent::visitAdditionalChildren(Visitor& visitor)
{
    wrapped().originalError().visit(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSErrorEvent);
```

Here, `DEFINE_VISIT_ADDITIONAL_CHILDREN` macro generates template instances of visitAdditionalChildren
which gets called by the JavaScriptCore's garbage collector.
When the garbage collector visits an instance `ErrorEvent` object,
it also visits `wrapped().originalError()`, which is the JavaScript value of "error" attribute:

```cpp
class ErrorEvent final : public Event {
...
    const JSValueInWrappedObject& originalError() const { return m_error; }
    SerializedScriptValue* serializedError() const { return m_serializedError.get(); }
...
    JSValueInWrappedObject m_error;
    RefPtr<SerializedScriptValue> m_serializedError;
    bool m_triedToSerialize { false };
};
```

Note that [`JSValueInWrappedObject`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/JSValueInWrappedObject.h)
uses [`Weak`](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/heap/Weak.h),
which does not keep the referenced object alive on its own.
We can't use a reference type such as [`Strong`](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/heap/Strong.h)
which keeps the referenced object alive on its own since the stored JS object may also have this `ErrorEvent` object stored as its property.
Because the garbage collector has no way of knowing or clearing the `Strong` reference
or the property to `ErrorEvent` in this hypothetical version of `ErrorEvent`,
it would never be able to collect either object, resulting in a memory leak.

To use this method of keeping a JavaScript object or wrapper alive, add `JSCustomMarkFunction` to the IDL file,
then introduce JS*Custom.cpp file under [Source/WebCore/bindings/js](https://github.com/WebKit/WebKit/tree/main/Source/WebCore/bindings/js)
and implement `template<typename Visitor> void JS*Event::visitAdditionalChildren(Visitor& visitor)` as seen above for `ErrorEvent`.

**visitAdditionalChildren is called concurrently** while the main thread is running.
Any operation done in visitAdditionalChildren needs to be multi-thread safe.
For example, it cannot increment or decrement the reference count of a `RefCounted` object
or create a new `WeakPtr` from `CanMakeWeakPtr` since these WTF classes are not thread safe.

### Opaque Roots

*Reachable from Opaque Roots* is the mechanism we use when we have an underlying C++ object and want to keep JS wrappers of other C++ objects alive.

To see why, let's consider a [`StyleSheet` object](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/css/StyleSheet.idl).
So long as this object is alive, we also need to keep the DOM node returned by the `ownerNode` attribute.
Also, the object itself needs to be kept alive so long as the owner node is alive
since this [`StyleSheet` object] can be accessed via [`sheet` IDL attribute](https://drafts.csswg.org/cssom/#the-linkstyle-interface)
of the owner node.
If we were to use the *visit children* mechanism,
we need to visit every JS wrapper of the owner node whenever this `StyleSheet` object is visited by the garbage collector,
and we need to visit every JS wrapper of the `StyleSheet` object whenever an owner node is visited by the garbage collector.
But in order to do so, we need to query every `DOMWrapperWorld`'s wrapper map to see if there is a JavaScript wrapper.
This is an expensive operation that needs to happen all the time,
and creates a tie coupling between `Node` and `StyleSheet` objects
since each JS wrapper objects need to be  aware of other objects' existence. 

*Opaque roots* solves these problems by letting the garbage collector know that a particular JavaScript wrapper needs to be kept alive
so long as the gargabe collector had encountered specific opaque root(s) this JavaScript wrapper cares about
even if the garbage collector didn't visit the JavaScript wrapper directly.
An opaque root is simply a `void*` identifier the garbage collector keeps track of during each marking phase,
and it does not conform to a specific interface or behavior.
It could have been an arbitrary integer value but `void*` is used out of convenience since pointer values of live objects are unique.

In the case of a `StyleSheet` object, `StyleSheet`'s JavaScript wrapper tells the garbage collector that it needs to be kept alive
because an opaque root it cares about has been encountered whenever `ownerNode` is visited by the garbage collector.

In the most simplistic model, the opaque root for this case will be the `ownerNode` itself.
However, each `Node` object also has to keep its parent, siblings, and children alive.
To this end, each `Node` designates the [root](https://dom.spec.whatwg.org/#concept-tree-root) node as its opaque root.
Both `Node` and `StyleSheet` objects use this unique opaque root as a way of communicating with the gargage collector.

For example, `StyleSheet` object informs the garbage collector of this opaque root when it's asked to visit its children in
[JSStyleSheetCustom.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/bindings/js/JSStyleSheetCustom.cpp):

```cpp
template<typename Visitor>
void JSStyleSheet::visitAdditionalChildren(Visitor& visitor)
{
    visitor.addOpaqueRoot(root(&wrapped()));
}
```

Here, `void* root(StyleSheet*)` returns the opaque root of the `StyleSheet` object as follows:

```cpp
inline void* root(StyleSheet* styleSheet)
{
    if (CSSImportRule* ownerRule = styleSheet->ownerRule())
        return root(ownerRule);
    if (Node* ownerNode = styleSheet->ownerNode())
        return root(ownerNode);
    return styleSheet;
}
```

And then in `JSStyleSheet.cpp` (located at `WebKitBuild/Debug/DerivedSources/WebCore/JSStyleSheet.cpp` for debug builds)
`JSStyleSheetOwner` (a helper JavaScript object to communicate with the garbage collector) tells the garbage collector
that `JSStyleSheet` should be kept alive so long as the garbage collector had encountered this `StyleSheet`'s opaque root:

```cpp
bool JSStyleSheetOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, const char** reason)
{
    auto* jsStyleSheet = jsCast<JSStyleSheet*>(handle.slot()->asCell());
    void* root = WebCore::root(&jsStyleSheet->wrapped());
    if (UNLIKELY(reason))
        *reason = "Reachable from jsStyleSheet";
    return visitor.containsOpaqueRoot(root);
}
```

Generally, using opaque roots as a way of keeping JavaScript wrappers involve two steps:
 1. Add opaque roots in `visitAdditionalChildren`.
 2. Return true in `isReachableFromOpaqueRoots` when relevant opaque roots are found.

The first step can be achieved by using the aforementioned `JSCustomMarkFunction` with `visitAdditionalChildren`.
Alternatively and more preferably, `GenerateAddOpaqueRoot` can be added to the IDL interface to auto-generate this code.
For example, [AbortController.idl](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/AbortController.idl)
makes use of this IDL attribute as follows:

```cpp
[
    Exposed=(Window,Worker),
    GenerateAddOpaqueRoot=signal
] interface AbortController {
    [CallWith=ScriptExecutionContext] constructor();

    [SameObject] readonly attribute AbortSignal signal;

    [CallWith=GlobalObject] undefined abort(optional any reason);
};
```

Here, `signal` is a public member function funtion of
the [underlying C++ object](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/AbortController.h):

```cpp
class AbortController final : public ScriptWrappable, public RefCounted<AbortController> {
    WTF_MAKE_ISO_ALLOCATED(AbortController);
public:
    static Ref<AbortController> create(ScriptExecutionContext&);
    ~AbortController();

    AbortSignal& signal();
    void abort(JSDOMGlobalObject&, JSC::JSValue reason);

private:
    explicit AbortController(ScriptExecutionContext&);

    Ref<AbortSignal> m_signal;
};
```

When `GenerateAddOpaqueRoot` is specified without any value, it automatically calls `opaqueRoot()` instead.

Like visitAdditionalChildren, **adding opaque roots happen concurrently** while the main thread is running.
Any operation done in visitAdditionalChildren needs to be multi-thread safe.
For example, it cannot increment or decrement the reference count of a `RefCounted` object
or create a new `WeakPtr` from `CanMakeWeakPtr` since these WTF classes are not thread safe.

The second step can be achived by adding `CustomIsReachable` to the IDL file and
implementing `JS*Owner::isReachableFromOpaqueRoots` in JS*Custom.cpp file.
Alternatively and more preferably, `GenerateIsReachable` can be added to IDL file to automatically generate this code
with the following values:
 * No value - Adds the result of calling `root(T*)` on the underlying C++ object of type T as the opaque root.
 * `Impl` - Adds the underlying C++ object as the opaque root.
 * `ReachableFromDOMWindow` - Adds a [`DOMWindow`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMWindow.h)
    returned by `window()` as the opaque root.
 * `ReachableFromNavigator` - Adds a [`Navigator`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Navigator.h)
    returned by `navigator()` as the opaque root.
 * `ImplDocument` - Adds a [`Document`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.h)
    returned by `document()` as the opaque root.
 * `ImplElementRoot` - Adds the root node of a [`Element`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Element.h)
    returned by `element()` as the opaque root.
 * `ImplOwnerNodeRoot` - Adds the root node of a [`Node`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Node.h)
    returned by `ownerNode()` as the opaque root.
 * `ImplScriptExecutionContext` - Adds a [`ScriptExecutionContext`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ScriptExecutionContext.h)
    returned by `scriptExecutionContext()` as the opaque root.

Similar to visiting children or adding opaque roots, **whether an opaque root is reachable or not is checked in parallel**.
However, it happens **while the main thread is paused** unlike visiting children or adding opaque roots,
which happen concurrently while the main thread is running.
This means that any operation done in `JS*Owner::isReachableFromOpaqueRoots`
or any function called by GenerateIsReachable cannot have thread unsafe side effects
such as incrementing or decrementing the reference count of a `RefCounted` object
or creating a new `WeakPtr` from `CanMakeWeakPtr` since these WTF classes' mutation operations are not thread safe.

## Active DOM Objects

Visit children and opaque roots are great way to express lifecycle relationships between JS wrappers
but there are cases in which a JS wrapper needs to be kept alive without any relation to other objects.
Consider [`XMLHttpRequest`](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest).
In the following example, JavaScript loses all references to the `XMLHttpRequest` object and its event listener
but when a new response gets received, an event will be dispatched on the object,
re-introducing a new JavaScript reference to the object.
That is, the object survives garbage collection's
[mark and sweep cycles](https://en.wikipedia.org/wiki/Tracing_garbage_collection#Basic_algorithm)
without having any ties to other ["root" objects](https://en.wikipedia.org/wiki/Tracing_garbage_collection#Reachability_of_an_object).

```js
function fetchURL(url, callback)
{
    const request = new XMLHttpRequest();
    request.addEventListener("load", callback);
    request.open("GET", url);
    request.send();
}
```

In WebKit, we consider such an object to have a *pending activity*.
Expressing the presence of such a pending activity is a primary use case of
[`ActiveDOMObject`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ActiveDOMObject.h).

By making an object inherit from [`ActiveDOMObject`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ActiveDOMObject.h)
and [annotating IDL as such](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/xml/XMLHttpRequest.idl#L42),
WebKit will [automatically generate `isReachableFromOpaqueRoot` function](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/bindings/scripts/CodeGeneratorJS.pm#L5029)
which returns true whenever `ActiveDOMObject::hasPendingActivity` returns true
even though the garbage collector may not have encountered any particular opaque root to speak of in this instance.

In the case of [`XMLHttpRequest`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/xml/XMLHttpRequest.h),
`hasPendingActivity` [will return true](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/xml/XMLHttpRequest.cpp#L1195)
so long as there is still an active network activity associated with the object.
Once the resource is fully fetched or failed, it ceases to have a pending activity.
This way, JS wrapper of `XMLHttpRequest` is kept alive so long as there is an active network activity.

There is one other related use case of active DOM objects,
and that's when a document enters the [back-forward cache](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/history/BackForwardCache.h)
and when the entire [page](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Page.h) has to pause
for [other reasons](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L45).

When this happens, each active DOM object associated with the document
[gets suspended](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L70).
Each active DOM object can use this opportunity to prepare itself to pause whatever pending activity;
for example, `XMLHttpRequest` [will stop dispatching `progress` event](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/xml/XMLHttpRequest.cpp#L1157)
and media elements [will stop playback](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/html/HTMLMediaElement.cpp#L6008).
When a document gets out of the back-forward cache or resumes for other reasons,
each active DOM object [gets resumed](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L71).
Here, each object has the opportunity to resurrect the previously pending activity once again.

### Creating a Pending Activity

There are a few ways to create a pending activity on an [active DOM objects](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ActiveDOMObject.h).

When the relevant Web standards says to [queue a task](https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-task) to do some work,
one of the following member functions of [`ActiveDOMObject`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ActiveDOMObject.h) should be used:
 * [`queueTaskKeepingObjectAlive`](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L106)
 * [`queueCancellableTaskKeepingObjectAlive`](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L114)
 * [`queueTaskToDispatchEvent`](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L124)
 * [`queueCancellableTaskToDispatchEvent`](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L130)
These functions will automatically create a pending activity until a newly enqueued task is executed.

Alternatively, [`makePendingActivity`](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L97)
can be used to create a [pending activity token](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ActiveDOMObject.h#L78)
for an active DOM object.
This will keep a pending activity on the active DOM object until all tokens are dead.

Finally, when there is a complex condition under which a pending activity exists,
an active DOM object can override [`virtualHasPendingActivity`](https://github.com/WebKit/WebKit/blob/64cdede660d9eaea128fd151281f4715851c4fe2/Source/WebCore/dom/ActiveDOMObject.h#L147)
member function and return true whilst such a condition holds.
Note that `virtualHasPendingActivity` should return true so long as there is a possibility of dispatching an event or invoke JavaScript in any way in the future.
In other words, a pending activity should exist while an object is doing some work in C++ well before any event dispatching is scheduled.
Anytime there is no pending activity, JS wrappers of the object can get deleted by the garbage collector.

## Reference Counting of DOM Nodes

[`Node`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Node.h) is a reference counted object but with a twist.
It has a [separate boolean flag](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/Node.h#L832)
indicating whether it has a [parent](https://dom.spec.whatwg.org/#concept-tree-parent) node or not.
A `Node` object is [not deleted](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/Node.h#L801)
so long as it has a reference count above 0 or this boolean flag is set.
The boolean flag effectively functions as a `RefPtr` from a parent `Node`
to each one of its [child](https://dom.spec.whatwg.org/#concept-tree-child) `Node`.
We do this because `Node` only knows its [first child](https://dom.spec.whatwg.org/#concept-tree-first-child)
and its [last child](https://dom.spec.whatwg.org/#concept-tree-last-child)
and each [sibling](https://dom.spec.whatwg.org/#concept-tree-sibling) nodes are implemented
as a [doubly linked list](https://en.wikipedia.org/wiki/Doubly_linked_list) to allow
efficient [insertion](https://dom.spec.whatwg.org/#concept-node-insert)
and [removal](https://dom.spec.whatwg.org/#concept-node-remove) and traversal of sibling nodes.

Conceptually, each `Node` is kept alive by its root node and external references to it,
and we use the root node as an opaque root of each `Node`'s JS wrapper.
Therefore the JS wrapper of each `Node` is kept alive as long as either the node itself
or any other node which shares the same root node is visited by the garbage collector.

On the other hand, a `Node` does not keep its parent or any of its
[shadow-including ancestor](https://dom.spec.whatwg.org/#concept-shadow-including-ancestor) `Node` alive
either by reference counting or via the boolean flag even though the JavaScript API requires this to be the case.
In order to implement this DOM API behavior,
WebKit [will create](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/bindings/js/JSNodeCustom.cpp#L174)
a JS wrapper for each `Node` which is being removed from its parent if there isn't already one.
A `Node` which is a root node (of the newly removed [subtree](https://dom.spec.whatwg.org/#concept-tree)) is an opaque root of its JS wrapper,
and the garbage collector will visit this opaque root if there is any JS wrapper in the removed subtree that needs to be kept alive.
In effect, this keeps the new root node and all its [descendant](https://dom.spec.whatwg.org/#concept-tree-descendant) nodes alive
if the newly removed subtree contains any node with a live JS wrapper, preserving the API contract.

It's important to recognize that storing a `Ref` or a `RefPtr` to another `Node` in a `Node` subclass
or an object directly owned by the Node can create a [reference cycle](https://en.wikipedia.org/wiki/Reference_counting#Dealing_with_reference_cycles),
or a reference that never gets cleared.
It's not guaranteed that every node is [disconnected](https://dom.spec.whatwg.org/#connected)
from a [`Document`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.h) at some point in the future,
and some `Node` may always have a parent node or a child node so long as it exists.
Only permissible circumstances in which a `Ref` or a `RefPtr` to another `Node` can be stored
in a `Node` subclass or other data structures owned by it is if it's temporally limited.
For example, it's okay to store a `Ref` or a `RefPtr` in
an enqueued [event loop task](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/EventLoop.h#L69).
In all other circumstances, `WeakPtr` should be used to reference another `Node`,
and JS wrapper relationships such as opaque roots should be used to preserve the lifecycle ties between `Node` objects.

It's equally crucial to observe that keeping C++ Node object alive by storing `Ref` or `RefPtr`
in an enqueued [event loop task](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/EventLoop.h#L69)
does not keep its JS wrapper alive, and can result in the JS wrapper of a conceptually live object to be erroneously garbage collected.
To avoid this problem, use [`GCReachableRef`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/GCReachableRef.h) instead
to temporarily hold a strong reference to a node over a period of time.
For example, [`HTMLTextFormControlElement::scheduleSelectEvent()`](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/html/HTMLTextFormControlElement.cpp#L547)
uses `GCReachableRef` to fire an event in an event loop task:
```cpp
void HTMLTextFormControlElement::scheduleSelectEvent()
{
    document().eventLoop().queueTask(TaskSource::UserInteraction, [protectedThis = GCReachableRef { *this }] {
        protectedThis->dispatchEvent(Event::create(eventNames().selectEvent, Event::CanBubble::Yes, Event::IsCancelable::No));
    });
}
```

Alternatively, we can make it inherit from an [active DOM object](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ActiveDOMObject.h),
and use one of the following functions to enqueue a task or an event:
 - [`queueTaskKeepingObjectAlive`](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/ActiveDOMObject.h#L107)
 - [`queueCancellableTaskKeepingObjectAlive`](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/ActiveDOMObject.h#L115)
 - [`queueTaskToDispatchEvent`](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/ActiveDOMObject.h#L124)
 - [`queueCancellableTaskToDispatchEvent`](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/ActiveDOMObject.h#L130)

[`Document`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Document.h) node has one more special quirk
because every [`Node`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Node.h) can have access to a document
via [`ownerDocument` property](https://developer.mozilla.org/en-US/docs/Web/API/Node/ownerDocument)
whether Node is [connected](https://dom.spec.whatwg.org/#connected) to the document or not.
Every document has a regular reference count used by external clients and
[referencing node count](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/Document.h#L2093).
The referencing node count of a document is the total number of nodes whose `ownerDocument` is the document.
A document is [kept alive](https://github.com/WebKit/WebKit/blob/297c01a143f649b34544f0cb7a555decf6ecbbfd/Source/WebCore/dom/Document.cpp#L749)
so long as its reference count and node referencing count is above 0.
In addition, when the regular reference count is to become 0,
it clears various states including its internal references to owning Nodes to sever any reference cycles with them.
A document is special in that sense that it can store `RefPtr` to other nodes.
Note that whilst the referencing node count acts like `Ref` from each `Node` to its owner `Document`,
storing a `Ref` or a `RefPtr` to the same document or any other document will create
a [reference cycle](https://en.wikipedia.org/wiki/Reference_counting#Dealing_with_reference_cycles)
and should be avoided unless it's temporally limited as noted above.

## Inserting or Removing DOM Nodes 

FIXME: Talk about how a node insertion or removal works.
