// fz-shapes.d.ts: the shapes of react-dom 19.1.0, cjs/react-dom-server.bun.production.js (Fizz). CARRIED OVER FROM 19.2.8's AND MENDED. READ OFF THIS BUNDLE'S OWN BIRTHS:
// the members of an interface stand in the order in which the birth STORES them (a chain this.a = this.b = 0 stores b first).
// "birth NNNN" = line of original.js. "given" = the value is made elsewhere (react, react-dom, Bun, the user).
// CHECKED BY PROGRAM (python3 shapes_check.py): the births named behind the heads have their interface's members, in its order; no two births of one interface differ; every FZ name the pieces use is declared.
// THE CHECKER DOES NOT LOOK INTO A .d.ts (it says "0 files"; a name that does not exist there is silently any): shapes_check.py checks all fz-shapes*.d.ts as .ts, and the births again. births.txt (python3 births.py): every birth of this bundle.
// WHAT 19.2.8 HAS AND THIS VERSION HAS NOT:
//   SuspenseListRow, Task.row, SuspenseBoundary.row (<SuspenseList> renders its children like a fragment here: 4122) · Request.byteSize · RenderState.startInlineStyle · NoncePair (RenderState.nonce is options.nonce itself)
//   FormatContext.viewTransition, ViewTransitionContext (<ViewTransition> throws here: 4128) · HoistableState.suspenseyImages · Dispatcher.useEffectEvent · AsyncDispatcher.cacheSignal
//   trackPostpone | trackPostponedBoundary | addToReplayParent (no SlotMap and no ReplayNode of 6 is born) · byteLengthOfChunk (SuspenseBoundary.byteSize stays 0; Buffer is not named) · the second birth of ComponentStackNode ("Suspense Fallback").
// WHAT THIS VERSION HAS AND 19.2.8 HAS NOT: Task.isFallback (the last member) · PreambleState.contribution (the last member).
declare namespace FZ {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; the build proves every value that is stored there, or stops.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = import("bun").int32;
  type RequestStatus = int32; // Request.status: 10 OPENING 11 OPEN 12 ABORTING 13 CLOSING 14 CLOSED
  type SegmentStatus = int32; // Segment.status: 0 PENDING 1 COMPLETED 2 FLUSHED 3 ABORTED 4 ERRORED 5 POSTPONED (tested 5073 5388 5601, never stored) 6 RENDERING
  type BoundaryStatus = int32; // SuspenseBoundary.status: 0 PENDING 1 COMPLETED 4 CLIENT_RENDERED
  type StylesheetState = int32; // StylesheetResource.state: 0 PENDING 1 PRELOADED 2 PREAMBLE 3 LATE
  type InsertionMode = int32; // 0 ROOT_HTML 1 HTML_HTML 2 HTML 3 HTML_HEAD 4 SVG 5 MATHML 6 TABLE 7 TABLE_BODY 8 TABLE_ROW 9 COLGROUP
  type TagScope = int32; // bits: 1 NOSCRIPT (459) 2 PICTURE (469)
  type PreambleContribution = int32; // PreambleState.contribution: bits: 1 html (2011) 4 head (2015) 2 body (2019); written as "" + it (2043)
  type InstructionState = int32; // bits: 1 $RS (5580) 2 $RC (5538) 4 $RX (5718) 8 $RR (5531) 16 form replay (812)
  type SegmentId = int32; // Segment.id, SuspenseBoundary.rootSegmentID, Request.nextSegmentId: -1 = none yet
  type ChildIndex = int32; // Task.childIndex: -1 = not a child of an array
  type TaskCount = int32; // every pendingTasks | allPendingTasks | pendingRootTasks
  type ChunkIndex = int32; // Segment.index, a length of chunks | children
  type TreeId = int32; // TreeContext.id: made by << | & alone
  type ContextDepth = int32;
  type HookCounter = int32; // localIdCounter actionStateCounter actionStateMatchingIndex (-1) thenableIndexCounter numberOfReRenders
  type ByteSize = int32; // SuspenseBoundary.byteSize: 0 AT THE BIRTH (3670) AND NEVER STORED AGAIN IN THIS BUNDLE (19.2.8 adds Buffer.byteLength to it: a number there); read once: > progressiveChunkSize (5461)
  type HeaderCapacity = number; // 2 + options.maxHeadersLength: NOT int32: the user's number

  // -------------------------------------------------------------------------------------------------------------------
  // GIVEN (section 2): what other code makes: `any` under a name. NEVER PUT ONE OF THESE IN A UNION: T | any IS any, silently.
  //    Where such a member or variable may hold null the comment says so; the type does not.
  // -------------------------------------------------------------------------------------------------------------------
  type ReactNode = any; // children, Task.node: element | lazy | thenable | context | iterable | text | nothing | garbage
  type ReactElement = any; // react's jsx() makes it: $$typeof type key props
  type Props = any; // an element's props
  type PropValue = any; // one value out of props or out of an options bag
  type ElementType = any; // element.type: string | function | class | symbol | { $$typeof .. }; ComponentStackNode.type
  type ComponentName = any; // getComponentNameFromType: type.displayName || type.name || null: a string | null by React's types, never tested
  type KeyOrIndex = any; // element.key (react makes it a string) or the child's index: carried, compared by ===, given to JSON
  type FunctionComponent = any; // also forwardRef's render
  type ClassComponent = any;
  type ClassInstance = any; // new type(props, context): updater props state context _reactInternals are stored on it by name
  type ClassState = any;
  type Ref = any;
  type ReactContext = any; // react's createContext makes it: _currentValue is read and stored by name
  type ContextValue = any;
  type LazyComponent = any; // _payload _init
  type Thenable = any; // the user's promise: status | value | reason are stored on it (trackUsedThenable)
  type Thrown = any; // what a catch clause holds, Request.fatalError, abort's reason
  type HookState = any; // Hook.memoizedState: state · [value, deps] · RefObject; Update.action
  type HookDeps = any; // the user's array of dependencies: never tested to be one. null | undefined when none
  type IteratorFn = any; // node[Symbol.iterator] (null when none: no getIteratorFn here, it is inlined: 4611), and the iterator and steps it gives
  type Destination = any; // Bun's direct stream controller: read by name. null when none
  type StreamController = any;
  type WebReadableStream = any;
  type AbortSignalGiven = any;
  type Options = any; // the bag the exported function is handed; the bag of preload | preloadModule | preinit*
  type ReactFormState = any; // options.formState: [state, keyPath, referenceId, boundArgumentCount]. null when none
  type FormAction = any; // a server action: $$FORM_ACTION $$IS_SIGNATURE_EQUAL bind
  type CustomFormFields = any; // what $$FORM_ACTION gives: name action encType method target data. null when none
  type FormDataGiven = any; // null when none
  type Nonce = any; // options.nonce: a string or undefined by React's types; null and 0 get through
  type SelectedValue = any; // <select>'s value | defaultValue. null when none
  type BootstrapScriptContent = any; // options.bootstrapScriptContent: string | undefined
  type BootstrapScripts = any; // options.bootstrapScripts | bootstrapModules: Array<string | { src, integrity, crossOrigin }> | undefined
  type ImportMap = any;
  type ReactModule = any; // require("react"): Children version __CLIENT_INTERNALS..
  type ReactDOMModule = any; // require("react-dom")
  type SharedInternals = any; // react's { H, A, T, S .. }: H and A are stored by name (performWork)
  type DOMSharedInternals = any; // react-dom's { d, p, findDOMNode }: d is stored by name (209)
  type HostDispatcherGiven = any; // previousDispatcher: react-dom's own { f r D C L m X S M }
  type GivenFunction = any;

  // -------------------------------------------------------------------------------------------------------------------
  // 3. Chunks, dictionaries, tuples
  // -------------------------------------------------------------------------------------------------------------------
  type Chunk = string; // the Bun bundle has no stringToChunk: a chunk IS the string; writeChunk tests .length (39)
  type PrecomputedChunk = string; // no stringToPrecomputedChunk either
  type Resource = Chunk[]; // a <link> | <script> as chunks; emptied by .length = 0 when flushed or adopted

  // DICTIONARIES: born {} (or by Object.assign, or by JSON.parse) and read by a computed name: plain objects, no layout.
  type PropsBag = { [name: string]: any }; // props MADE here: {} 3900 4296 · 306 358 (members are ADDED behind the birth) · every first argument and result of assign()
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag; // var assign: so that its literal first arguments are checked as dictionaries
  type NameCache = { [name: string]: boolean }; // births 51 52
  type PreloadState = PropValue[]; // [] (PRELOAD_NO_CREDS 220, one array, compared by .length) | [crossOrigin, integrity] births 2526 2544 2603 5048
  type ResourceDict = { [key: string]: PreloadState | null }; // null = Exists. births 276 279 280 423..425 427 2554 2611
  type ExistsDict = { [key: string]: null }; // births 277 278 421 422
  type UnknownResourceDict = { [as: string]: ResourceDict }; // births 420 426
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict }; // births 278 422: { default, anonymous, credentials }: only ever read as [bucket]
  type SlotMap = { [index: string]: SegmentId | undefined }; // NO BIRTH AND NO STORE in this bundle (19.2.8's trackPostpone makes them); READ FOR EVERY CHILD INDEX, also those without a slot (4727), and told apart by "number" === typeof (4728): undefined = absent; members are deleted as they are resumed (4730 4948)
  type ThrownInfo = { [name: string]: unknown }; // births 3800 5057 5293 5865 5930: {}; componentStack is an ACCESSOR put by Object.defineProperty (3802). Only handed to onError

  // TUPLES: arrays the bundle builds; JSON.stringify sees the first (useActionState 3174 3197).
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex]; // births 4181 4279 4422 4575 4669
  /**
   * birth 4182 (4 long). NONE OF 6 IS BORN HERE (19.2.8's trackPostponedBoundary makes them): the text that reads them is here all the same (4492 4496 4498 4920). ONE TYPE: a 6 is made a 4 by .length = 4 (4750).
   * 4 === node.length (4430 4910) tells them apart but does not narrow: node[4]! node[5]! in the other branch.
   */
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null; // null nothing · a number: resume at the root position · a map: child index -> segment id
  type ThenableState = Thenable[]; // birth 3220
  type MemoState = [value: any, deps: HookDeps]; // birth 3129, in Hook.memoizedState
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null]; // births 3087 3089 3106
  type OptimisticTuple = [state: HookState, dispatch: Dispatch]; // birth 3303
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void]; // birth 3272
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean]; // births 3206 3209
  type ComponentFrameSample = [sample: string | null, control: string | null]; // births 3390 3392

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Request
  // -------------------------------------------------------------------------------------------------------------------
  interface Request { // birth 3549 RequestInstance
    destination: Destination; // null when none
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number; // 12800 | options.progressiveChunkSize (given: React's type says number)
    status: RequestStatus;
    fatalError: Thrown; // null until fatalError() | abort()
    nextSegmentId: number;
    allPendingTasks: number;
    pendingRootTasks: number;
    completedRootSegment: Segment | null;
    completedPreambleSegments: Segment[][] | null;
    abortableTasks: Set<Task>;
    pingedTasks: Task[];
    clientRenderedBoundaries: SuspenseBoundary[];
    completedBoundaries: SuspenseBoundary[];
    partialBoundaries: SuspenseBoundary[];
    trackedPostpones: PostponedHoles | null; // null at the birth and never stored again IN THIS BUNDLE (no prerender here)
    onError: ErrorHandler;
    onPostpone: PostponeHandler; // never read
    onAllReady: () => void;
    onShellReady: () => void;
    onShellError: (error: Thrown) => void;
    onFatalError: (error: Thrown) => void;
    formState: ReactFormState; // null when none
  }
  /** function RequestInstance(this: FZ.Request, ..) and new (RequestInstance as FZ.RequestConstructor)(..): with the call signature beside the construct signature the cast needs no `unknown`, through which the function would leave typed code */
  interface RequestConstructor {
    new (
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      onPostpone: PostponeHandler | undefined,
      formState: ReactFormState
    ): Request;
    (this: Request,
      resumableState: ResumableState,
      renderState: RenderState,
      rootFormatContext: FormatContext,
      progressiveChunkSize: number | undefined,
      onError: ErrorHandler | undefined,
      onAllReady: (() => void) | undefined,
      onShellReady: (() => void) | undefined,
      onShellError: ((error: Thrown) => void) | undefined,
      onFatalError: ((error: Thrown) => void) | undefined,
      onPostpone: PostponeHandler | undefined,
      formState: ReactFormState
    ): void;
  }
  type ErrorHandler = (error: Thrown, errorInfo: ThrownInfo) => any; // the user's, or defaultErrorHandler. The result: a digest; what is no string | null | undefined is dropped
  type ErrorDigest = string | null | undefined; // logRecoverableError's result
  type PostponeHandler = (reason: string, postponeInfo: ThrownInfo) => void; // options.onPostpone (the user's), or noop: stored by RequestInstance (3581), never read in this bundle

  // -------------------------------------------------------------------------------------------------------------------
  // 5. Task, Segment, SuspenseBoundary
  // -------------------------------------------------------------------------------------------------------------------
  /** React's RenderTask (3702: replay null, blockedSegment a Segment) and ReplayTask (3746: replay a ReplaySet, blockedSegment null): THE SAME MEMBERS IN THE SAME ORDER, and resumeNode (4384 4394) turns one into the other and back: ONE SHAPE */
  interface Task { // birth 3702 3746
    replay: ReplaySet | null;
    node: ReactNode;
    childIndex: ChildIndex;
    ping: () => void; // handed to thenable.then(ping, ping)
    blockedBoundary: SuspenseBoundary | null; // null = the root
    blockedSegment: Segment | null;
    blockedPreamble: PreambleState | null;
    hoistableState: HoistableState | null;
    abortSet: Set<Task>;
    keyPath: KeyNode | null; // null = the root
    formatContext: FormatContext;
    context: ContextNode | null;
    treeContext: TreeContext;
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
    isFallback: boolean; // never stored again: !1 the root (3639) · !0 a boundary's fallback (4284 4580) · else the parent task's
  }
  interface Segment { // birth 3777
    status: SegmentStatus;
    parentFlushed: boolean;
    id: number;
    index: ChunkIndex; // where in the parent's chunks it goes
    chunks: Chunk[];
    children: Segment[];
    preambleChildren: Segment[];
    parentFormatContext: FormatContext;
    boundary: SuspenseBoundary | null;
    lastPushedText: boolean;
    textEmbedded: boolean;
  }
  interface SuspenseBoundary { // birth 3664
    status: BoundaryStatus;
    rootSegmentID: number;
    parentFlushed: boolean;
    pendingTasks: number;
    completedSegments: Segment[];
    byteSize: ByteSize; // 0 throughout
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    contentPreamble: PreambleState | null;
    fallbackPreamble: PreambleState | null;
    trackedContentKeyPath: KeyNode | null;
    trackedFallbackNode: ReplayNode | null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Postponing and replaying. DEAD IN THIS BUNDLE, AND STILL ITS TEXT: nothing stores Request.trackedPostpones (null at the birth: 3579), no task is born
  //    with a replay but from a task that has one (createReplayTask's callers: 4562 4753): the code that reads them is typed all the same.
  // -------------------------------------------------------------------------------------------------------------------
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots } // NO BIRTH in this bundle (19.3.0's createPrerenderRequest makes it); workingMap alone is read (4183 4748)
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: number } // birth 4442 4525 4565 4681

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The DOM side: RenderState, ResumableState, FormatContext, resources
  // -------------------------------------------------------------------------------------------------------------------
  interface RenderState { // birth 264
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    preamble: PreambleState;
    externalRuntimeScript: null; // never stored again, never read
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | undefined; // onHeadersImpl (5889) or undefined: never stored again
    headers: PreloadHeaders | null; // null once they are emitted (5006)
    resets: ResourceResets;
    charsetChunks: Chunk[];
    viewportChunks: Chunk[];
    hoistableChunks: Chunk[];
    preconnects: Set<Resource>;
    fontPreloads: Set<Resource>;
    highImagePreloads: Set<Resource>;
    styles: Map<string, StyleQueue>; // by precedence
    bootstrapScripts: Set<Resource>;
    scripts: Set<Resource>;
    bulkPreloads: Set<Resource>;
    preloads: PreloadMaps;
    nonce: Nonce; // options.nonce as it came, undefined when none: never stored again, never read
    hoistableState: HoistableState | null; // never stored again, never read
    stylesToHoist: boolean;
  }
  type OnHeaders = (headers: PropsBag) => void; // is handed { Link } or {} (5053)
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity } // birth 256
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict } // birth 275
  interface PreloadMaps { // birth 292
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface ResumableState { // birth 410
    idPrefix: string; // "" | options.identifierPrefix (given: React's type says string)
    nextFormID: number;
    streamingFormat: int32; // 0, never read
    bootstrapScriptContent: BootstrapScriptContent; // NOT OPTIONAL HERE (19.3.0: optional, for what JSON made of a postponed state): one birth, all 17 members, no resume
    bootstrapScripts: BootstrapScripts;
    bootstrapModules: BootstrapScripts;
    instructions: InstructionState;
    hasBody: boolean;
    hasHtml: boolean;
    unknownResources: UnknownResourceDict;
    dnsResources: ExistsDict;
    connectResources: ConnectResources;
    imageResources: ResourceDict;
    styleResources: ResourceDict;
    scriptResources: ResourceDict;
    moduleUnknownResources: UnknownResourceDict;
    moduleScriptResources: ResourceDict;
  }
  interface PreambleState { htmlChunks: Chunk[] | null; headChunks: Chunk[] | null; bodyChunks: Chunk[] | null; contribution: PreambleContribution } // birth 431
  interface FormatContext { // birth 439
    insertionMode: InsertionMode;
    selectedValue: SelectedValue; // null when none
    tagScope: TagScope;
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource> } // birth 2380
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> } // birth 1516 1668 2636
  interface StylesheetResource { state: StylesheetState; props: PropsBag } // birth 1523 2643: props is what assign() made

  // -------------------------------------------------------------------------------------------------------------------
  // 8. The stacks a task carries
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextNode { // birth 4329. React's ContextSnapshot = ContextNode | null
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType } // birth 3796
  interface TreeContext { id: TreeId; overflow: string } // birth 2919 2935 2943

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Hooks, the tables of functions handed to react and react-dom, classes
  // -------------------------------------------------------------------------------------------------------------------
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null } // birth 3039
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null } // birth 3100: last is never stored again, never read
  interface Update { action: HookState; next: Update | null } // birth 3140
  interface RefObject { current: any } // birth 3249: handed to the user, kept in Hook.memoizedState
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  /** births 3181 3211: a function; 3185 stores a member on the first */
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  /** var HooksDispatcher: FZ.Dispatcher = { .. }: the function expressions in it then need no annotation. react reads it by name off SharedInternals.H */
  interface Dispatcher { // birth 3227
    readContext(context: ReactContext): ContextValue;
    use(usable: any): any;
    useContext(context: ReactContext): ContextValue;
    useMemo(nextCreate: () => any, deps?: HookDeps): any;
    useReducer(reducer: Reducer, initialArg: any, init?: (initialArg: any) => any): DispatchTuple;
    useRef(initialValue: any): RefObject;
    useState(initialState?: any): DispatchTuple;
    useInsertionEffect(create?: GivenFunction, deps?: HookDeps): void;
    useLayoutEffect(create?: GivenFunction, deps?: HookDeps): void;
    useCallback(callback: GivenFunction, deps?: HookDeps): GivenFunction;
    useImperativeHandle(ref?: Ref, create?: GivenFunction, deps?: HookDeps): void;
    useEffect(create?: GivenFunction, deps?: HookDeps): void;
    useDebugValue(value?: any, formatterFn?: GivenFunction): void;
    useDeferredValue(value: any, initialValue?: any): any;
    useTransition(): TransitionTuple;
    useId(): string;
    useSyncExternalStore(subscribe: GivenFunction, getSnapshot: GivenFunction, getServerSnapshot?: GivenFunction): any;
    useOptimistic(passthrough: any, reducer?: GivenFunction): OptimisticTuple;
    useActionState(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple;
    useFormState(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple;
    useHostTransitionStatus(): FormStatusNotPending;
    useMemoCache(size: number): any[];
    useCacheRefresh(): () => void;
  }
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any } // birth 3321: it throws
  interface FormStatusNotPending { pending: boolean; data: null; method: null; action: null } // birth 202: handed to the user
  /** stored by name to DOMSharedInternals.d: react-dom reads it by name */
  interface HostDispatcher { // birth 209
    f: GivenFunction; // previousDispatcher.f
    r: GivenFunction; // previousDispatcher.r
    D(href: PropValue): void;
    C(href: PropValue, crossOrigin?: PropValue): void;
    L(href: PropValue, as: PropValue, options?: Options): void;
    m(href: PropValue, options?: Options): void;
    X(src: PropValue, options?: Options): void;
    S(href: PropValue, precedence?: PropValue, options?: Options): void;
    M(src: PropValue, options?: Options): void;
  }
  /** stored by name to ClassInstance.updater: react's Component.prototype.setState calls it by name, with (inst, payload, callback, "setState") */
  interface ClassComponentUpdater { // birth 2907
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean } // birth 3922: stored by name to ClassInstance._reactInternals (3923), comes back as any (2909 2913)

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Small things
  // -------------------------------------------------------------------------------------------------------------------
  /** BORN EMPTY: {}. The one member says: there is no member: so that no other shape is assignable to it. Made for every function component rendered; compared by === (dispatchAction) */
  interface ComponentIdentity { readonly $$fzIdentity?: never } // birth 3843
  /** BORN EMPTY: {}. emptyContextObject: handed to the user's classes as their context */
  interface EmptyContext { readonly $$fzEmptyContext?: never } // birth 2839
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 3351 (not in births.txt)
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals the bundle names and the checker's library (ES only) lacks. Delete this block when a real library is in.
// ---------------------------------------------------------------------------------------------------------------------
declare var require: (name: string) => any;
declare var exports: any;
declare var console: { error(...data: any[]): void };
declare var Bun: { hash(data: string): number | bigint };
declare var ReadableStream: new (source: any, strategy?: any) => FZ.WebReadableStream;
declare var Headers: new (init?: any) => any;
declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function queueMicrotask(callback: () => void): void;

// ---------------------------------------------------------------------------------------------------------------------
// A. THE MODULE-LEVEL VARIABLES (88 declarators in 28 statements). Not listed = a constant symbol | regular expression |
//    string: leave it to inference (the 18 REACT_* of 14..31, MAYBE_ITERATOR_SYMBOL, REACT_CLIENT_REFERENCE, the 12 patterns, actionJavaScriptURL, isomorphicReactPackageVersion..: 34). The other 54:
// ---------------------------------------------------------------------------------------------------------------------
//   12 React                                       FZ.ReactModule
//   13 ReactDOM                                    FZ.ReactDOMModule
//   33 isArrayImpl                                 inference (Array.isArray: a type guard to any[])
//   34 scheduleMicrotask                           inference
//   46 assign                                      FZ.Assign
//   47 hasOwnProperty                              inference
//   51 illegalAttributeNameCache                   FZ.NameCache
//   52 validatedAttributeNameCache                 FZ.NameCache
//   62 unitlessNumbers                             Set<string>            (inference gives it)
//   67 aliases                                     Map<string, string>    (inference gives it)
//  198 ReactSharedInternals                        FZ.SharedInternals
//  200 ReactDOMSharedInternals                     FZ.DOMSharedInternals
//  202 sharedNotPendingObject                      FZ.FormStatusNotPending
//  208 previousDispatcher                          FZ.HostDispatcherGiven
//  209 ReactDOMSharedInternals.d = { .. }          no variable: the literal goes into any: = { .. }/*$*/ as FZ.HostDispatcher/*$*/;
//  220 PRELOAD_NO_CREDS                            FZ.PreloadState
//  502 styleNameCache                              Map<string, FZ.Chunk>
//  973 validatedTagCache                           Map<string, FZ.Chunk>
// 2000 endTagCache                                 Map<string, FZ.Chunk>
// 2177 currentlyRenderingBoundaryHasStylesToHoist  boolean
// 2178 destinationHasCapacity                      boolean
// 2215 stylesheetFlushingQueue                     FZ.Chunk[]
// 2785 bind                                        inference
// 2839 emptyContextObject                          FZ.EmptyContext
// 2840 currentActiveSnapshot                       FZ.ContextNode | null
// 2907 classComponentUpdater                       FZ.ClassComponentUpdater
// 2919 emptyTreeContext                            FZ.TreeContext
// 2948 clz32                                       (x: number) => number
// 2949 log · 2950 LN2                              inference
// 2955 SuspenseException                           inference (Error)
// 3000 suspendedThenable                           FZ.Thenable            (null when none)
// 3013 objectIs                                    (x: FZ.ComparedValue, y: FZ.ComparedValue) => boolean
// 3014 currentlyRenderingComponent                 FZ.ComponentIdentity | null
// 3015 currentlyRenderingTask                      FZ.Task | null
// 3016 currentlyRenderingRequest                   FZ.Request | null
// 3017 currentlyRenderingKeyPath                   FZ.KeyNode | null
// 3018 firstWorkInProgressHook                     FZ.Hook | null
// 3019 workInProgressHook                          FZ.Hook | null
// 3020 isReRender · 3021 didScheduleRenderPhaseUpdate   boolean
// 3022 localIdCounter · 3023 actionStateCounter · 3024 actionStateMatchingIndex · 3025 thenableIndexCounter   FZ.HookCounter
// 3026 thenableState                               FZ.ThenableState | null
// 3027 renderPhaseUpdates                          Map<FZ.UpdateQueue, FZ.Update> | null
// 3028 numberOfReRenders                           FZ.HookCounter
// 3227 HooksDispatcher                             FZ.Dispatcher
// 3320 currentResumableState                       FZ.ResumableState | null
// 3321 DefaultAsyncDispatcher                      FZ.AsyncDispatcher
// 3326 prefix · 3327 suffix                        string | undefined
// 3344 reentry                                     boolean                (inference gives it)
// 3645 currentRequest                              FZ.Request | null
// 19.2.8's currentlyFlushingRenderState, flushedByteSize and flushingPartialBoundaries are not here.

// ---------------------------------------------------------------------------------------------------------------------
// B. A PARAMETER'S NAME SAYS ITS TYPE, in all 144 functions, so that the 11 pieces agree. THE TYPE THAT ARRIVES (rule 4a's name$given).
//    READ OFF THE PIECES BY PROGRAM at the end of round 1: no parameter of a top-level function is bare.
// ---------------------------------------------------------------------------------------------------------------------
// request request$jscomp$0 request$jscomp$2   FZ.Request
// task                                        FZ.Task
// destination                                 FZ.Destination
// target target$jscomp$0                      FZ.Chunk[]             (adoptPreloadCredentials: FZ.PropsBag)
// renderState · resumableState                FZ.RenderState · FZ.ResumableState
// preambleState                               FZ.PreambleState       (pushStartInstance: | null)
// formatContext parentContext parentFormatContext rootFormatContext   FZ.FormatContext
// hoistableState                              FZ.HoistableState | null   (never null: writeHoistablesForBoundary writeStyleResourceDependenciesInJS flushSegmentContainer)
// segment                                     FZ.Segment             (finishedTask: | null)
// boundary                                    FZ.SuspenseBoundary    (| null: createPendingSegment abortRemainingReplayNodes finishedTask)
// blockedBoundary · blockedSegment · blockedPreamble   FZ.SuspenseBoundary | null · FZ.Segment · FZ.PreambleState | null
// abortSet fallbackAbortableTasks             Set<FZ.Task>
// contentPreamble fallbackPreamble (createSuspenseBoundary)   FZ.PreambleState | null
// keyPath                                     FZ.KeyNode             (createRenderTask createReplayTask: | null)
// context                                     FZ.ContextNode | null
// prev next · newSnapshot                     FZ.ContextNode · FZ.ContextNode | null
// treeContext baseContext                     FZ.TreeContext
// componentStack node$jscomp$0 (getThrownInfo)   FZ.ComponentStackNode | null
// thenableState                               FZ.ThenableState | null   (trackUsedThenable: never null)
// replay · nodes · slots                      FZ.ReplaySet · FZ.ReplayNode[] · FZ.ResumeSlots
// node                                        FZ.ReactNode
// children                                    FZ.ReactNode           (renderChildrenArray: FZ.ReactNode[])
// props · type · ref                          FZ.Props · FZ.ElementType (string: getChildFormatContext pushStartInstance) · FZ.Ref
// Component · secondArg · fn                  FZ.FunctionComponent · FZ.Ref · FZ.ElementType
// styleQueue · stylesheet · resource          FZ.StyleQueue · FZ.StylesheetResource · FZ.Resource
// collectedPreambleSegments                   FZ.Segment[][]
// errorInfo · errorDigest$jscomp$0            FZ.ThrownInfo · FZ.ErrorDigest
// error reason                                FZ.Thrown
// thenable                                    FZ.Thenable
// options params                              FZ.Options
// value style innerHTML href as src crossOrigin precedence formEncType formMethod formTarget permalink key   FZ.PropValue · text: FZ.PropValue (pushTextInstance: string) · input: string
// initialState initialArg state action        FZ.HookState           (useActionState's action: FZ.FormAction)
// formAction · nonce · importMap · selectedValue · formState   FZ.FormAction · FZ.Nonce · FZ.ImportMap · FZ.SelectedValue · FZ.ReactFormState
// identifierPrefix externalRuntimeConfig maxHeadersLength namespaceURI   FZ.PropValue (off the options) · bootstrapScriptContent: FZ.BootstrapScriptContent · bootstrapScripts bootstrapModules: FZ.BootstrapScripts
// progressiveChunkSize onError onAllReady onShellReady onShellError onFatalError onPostpone   as in FZ.RequestConstructor · onHeaders: FZ.OnHeaders | undefined
// name tag attributeName match prefix s suffix   string   (FZ.PropValue: pushFormActionAttribute's and describeBuiltInComponentFrame's name)
// chunk                                       FZ.Chunk
// childIndex                                  FZ.ChildIndex
// id segmentId                                FZ.SegmentId
// index totalChildren                         FZ.int32 (createPendingSegment's index: FZ.ChunkIndex) · actionStateCount actionStateMatchingIndex: FZ.HookCounter · insertionMode: FZ.InsertionMode · tagScope: FZ.TagScope
// textEmbedded lastPushedText construct shellComplete hasId isFallback   boolean
// preloadState                                FZ.PreloadState
// reducer · init · nextCreate · deps          FZ.Reducer · (initialArg: FZ.HookState) => FZ.HookState, optional · () => FZ.MemoValue · FZ.HookDeps
// componentIdentity · queue                   FZ.ComponentIdentity · FZ.UpdateQueue
// x y                                         number (clz32Fallback) · FZ.ComparedValue (is)
// `this`: FZ.Chunk[] pushAdditionalFormField · FZ.Destination flushStyleTagsLateForBoundary flushResource flushStyleInPreamble flushStylesInPreamble
//   preloadLateStyle preloadLateStyles · FZ.HoistableState hoistStyleQueueDependency hoistStylesheetDependency · FZ.Request abortTaskSoft RequestInstance

// ---------------------------------------------------------------------------------------------------------------------
// C. RESULTS that callers in other pieces lean on. Not listed = void, or plain to inference.
// ---------------------------------------------------------------------------------------------------------------------
// string: escapeTextForBrowser scriptReplacer styleReplacer escapeJS*ForInstructionScripts getPreloadAsHeader the two escape*Replacer flattenOptionChildren
//   describeBuiltInComponentFrame describeNativeComponentFrame describeComponentStackByType · FZ.ComponentName: getComponentNameFromType
// FZ.Chunk: startChunkForTag endChunkForTag · number: clz32Fallback
// boolean: isAttributeNameSafe pushTextInstance writeBootstrap writeStartPendingSuspenseBoundary writeStartSegment writeEndSegment hasStylesToHoist
//   writeHoistablesForBoundary is preparePreambleFromSubtree preparePreambleFromSegment
//   flushSubtree flushSegment flushSegmentContainer flushCompletedBoundary flushPartiallyCompletedSegment
// null: pushLinkImpl pushSelfClosing pushTitleImpl pushScriptImpl defaultErrorHandler
// FZ.ReactNode: pushStartSingletonElement pushStartGenericElement pushStartInstance renderWithHooks
// FZ.FulfilledValue: trackUsedThenable · FZ.UsedValue: unwrapThenable · FZ.HookState: basicStateReducer · FZ.MemoValue: useMemo
// sanitizeURL<T>(url: T): T | string
// getCustomFormFields: FZ.CustomFormFields · pushFormActionAttribute: FZ.FormDataGiven
// createRenderState: FZ.RenderState · createResumableState: FZ.ResumableState · createPreambleState: FZ.PreambleState · createHoistableState: FZ.HoistableState
// createFormatContext createRootFormatContext getChildFormatContext: FZ.FormatContext
// pushTreeContext: FZ.TreeContext
// getSuspendedThenable: FZ.Thenable · getThenableStateAfterSuspending: FZ.ThenableState | null · resolveCurrentlyRenderingComponent: FZ.ComponentIdentity
// createHook createWorkInProgressHook: FZ.Hook · useReducer: FZ.DispatchTuple · useActionState: FZ.ActionStateTuple
// createRequest: FZ.Request
// createSuspenseBoundary: FZ.SuspenseBoundary · createRenderTask createReplayTask spawnNewSuspendedReplayTask spawnNewSuspendedRenderTask: FZ.Task
// createPendingSegment: FZ.Segment
// getThrownInfo: FZ.ThrownInfo · logRecoverableError: FZ.ErrorDigest
// renderNode renderNodeDestructive retryNode: void (they `return` the void of one another)
// exports.renderToReadableStream: Promise<FZ.WebReadableStream>

// ---------------------------------------------------------------------------------------------------------------------
// D. BIRTHS LEFT WITHOUT AN INTERFACE, ON PURPOSE: literals handed straight to a built-in, to given code, or to a for..in of ours, never stored to again.
// ---------------------------------------------------------------------------------------------------------------------
// 3406 3818 { value } 3358 { set } 3802 { configurable, enumerable, get } -> Object.defineProperty
// 5053 { Link } | {} -> onHeaders · 5916 { type, pull, cancel } 5940 { highWaterMark } -> ReadableStream
// 1836 5032 -> getPreloadAsHeader's params (for..in) · 1851 2254 2410 2460 -> pushLinkImpl's props (for..in) · 1525 { data-precedence, precedence } -> a source of assign()
// DICTIONARIES, NOT LAYOUTS (section 3): 306 358 and the first arguments of assign (1525 1594 2505 2519 2537 2571 2616 2646 2673 2699 3906 3935 3977): FZ.PropsBag ·
//   278 422 { default, anonymous, credentials }: FZ.ConnectResources

// ---------------------------------------------------------------------------------------------------------------------
// E. THE VARIABLES THAT HOLD TWO OR MORE KINDS OF OBJECT. p = a parameter (rule 4a) · l = a local (rule 4c: a marked variable a role).
//    `a > b` = holds a, later b. given = any. What is not listed holds one kind of object at most, beside numbers | strings | booleans | null | undefined.
//    A variable that STARTS as any (var key = node.key) stays any for the checker: a born literal stored to it is checked against nothing: split that role off too.
//    E1: FUNCTIONS WHOSE TEXT IS 19.2.8's TO THE LETTER (100 of the 144, compared by program): what was found there holds here.
//    E2: FUNCTIONS WHOSE TEXT DIFFERS (41) OR THAT ARE HERE ALONE (3: writePreambleContribution noop$1 noop$2). createRenderState is read off THIS text below. FOR THE OTHERS
//        THE ROLES ARE THOSE MARKED IN parts/NN.cts, AND splits.py IS THEIR JUDGE: 19.2.8's list is no guide: the minifier shares the names otherwise. They are:
//        createPreambleState createFormatContext createRootFormatContext getChildFormatContext injectFormReplayingRuntime pushStartInstance hoistPreambleState flushStyleTagsLateForBoundary
//        writeHoistablesForBoundary flushStylesInPreamble createHoistableState getComponentNameFromType trackUsedThenable describeComponentStackByType defaultErrorHandler RequestInstance createRequest
//        createSuspenseBoundary createRenderTask createReplayTask renderElement resumeNode retryNode spawnNewSuspendedReplayTask spawnNewSuspendedRenderTask renderNode abortTaskSoft
//        abortRemainingReplayNodes abortTask queueCompletedSegment finishedTask performWork preparePreambleFromSegment preparePreamble flushSubtree flushSegment flushCompletedBoundary
//        flushPartiallyCompletedSegment flushCompletedQueues abort
// ---------------------------------------------------------------------------------------------------------------------
// E1
// writeBootstrap p renderState > Chunk[], l i int32 > Chunk · preloadLateStyle p stylesheet > int32
// prefetchDNS preconnect preload   l resumableState ResumableState > PreloadHeaders | null (> Resource in preload) · l header string > Resource (prefetchDNS)
//   l bucket ConnectBucket > Resource (preconnect) · l imageSrcSet given > Resource > ResourceDict (preload) · p href given > PropsBag (2571)
// preloadModule l as string > Resource
// preinitStyle p precedence given > StylesheetResource (2643), l renderState RenderState > Resource | undefined
// preinitScript preinitModuleScript   p src given > Resource | undefined > Resource · p options given > PropsBag
// useReducer p reducer Reducer > state > UpdateQueue (3100) > Dispatch · p initialArg given > Dispatch | null · p init > Update | undefined | null · l queue UpdateQueue | null > state
// dispatchAction p componentIdentity ComponentIdentity > Update (3140) · p action given > Update | undefined · p queue UpdateQueue > Update
// HooksDispatcher.useRef initialValue given > RefObject (3249) · useActionState p action given > ActionDispatch (3181), l request Request | null > ReactFormState
// describeNativeComponentFrame l RunInRootFrame > int32 · l namePropDescriptor PropertyDescriptor | undefined > int32 · l Fake a function > boolean > given
// logRecoverableError p request > ErrorHandler, p error > the handler's result · completeShell completeAll p request > () => void
// renderWithHooks p request > ReactNode · finishFunctionComponent p keyPath KeyNode > TreeContext · p actionStateCount int32 > KeyNode | null · l segment Segment | null > Chunk[]
// renderNodeDestructive p node given > ComponentStackNode | null
// renderChildrenArray p request IS NOT STORED TO · p children ReactNode[] > ThrownInfo > ErrorDigest · p childIndex ChildIndex > ReplayNode[] > int32 > given · l replay ReplaySet > TreeContext
//   l replayNodes ReplayNode[] > int32 · l j int32 > ResumeSlots > int32 · l node ReplayNode > ResumeSlots > given · l boundary SuspenseBoundary | null > SegmentId | undefined
// untrackBoundary p request > PostponedHoles | null · p boundary > KeyNode | null > ReplayNode | undefined
// E2
// createRenderState (once a request: cold)   p nonce IS NOT STORED TO (births.txt names it for the `nonce="` inside a string) · p externalRuntimeConfig given, never read > Chunk[] (238: RenderState.bootstrapChunks)
//   p importMap given > PreloadHeaders | null (256) > int32 (the index of the first loop) > string | given (a module's src) · p onHeaders OnHeaders | undefined > RenderState (264)
//   p maxHeadersLength given > string | given (a script's src) > string | undefined (a module's crossOrigin): all under any, no shape among them
//   l inlineScriptWithNonce string > string | undefined (a script's crossOrigin, a module's integrity): one union, no role · l idPrefix string > string | undefined (a script's integrity) > PropsBag (358)
//   l bootstrapScriptContent given > Chunk[] (248: importMapChunks) > PropsBag (306) > given (one of bootstrapModules) > ResumableState > Resource (381) · l bootstrapScripts given > int32 (the index of the second loop)
//   l scriptConfig given (one of bootstrapScripts) > ResumableState > Resource (329) > string | given (the second loop's key). 19.2.8's nonceStyle, inlineStyleWithNonce and bootstrapChunks are not here

// ---------------------------------------------------------------------------------------------------------------------
// F. IDIOMS, probed on the checker
// ---------------------------------------------------------------------------------------------------------------------
// catch (x: FZ.Thrown) · new Set<FZ.Task>() (3562 4149 4505; 4925 takes it from the parameter) · new Map<FZ.KeyNode, FZ.ReplayNode>() comes by itself where the literal around it is typed
// an array literal becomes a tuple only against its type: a role declared FZ.KeyNode (4181 4422), a role declared FZ.ReplayNode (4182), a parameter or member of that type (4279 4575 4669)
// dict.hasOwnProperty(key) is Object's own method, not the index signature · delete slots[i] and for (var index in slots) pass on FZ.SlotMap · slots[i] reads as SegmentId | undefined BY THE ALIAS: no cast; "number" === typeof narrows both branches (the other dictionaries are only read behind hasOwnProperty: their values carry no undefined)
// var bucket: FZ.ConnectBucket | FZ.Resource · boundary.length = 4 passes on FZ.ReplayNode (4750)
// pushAllNext(newSnapshot!) (2897): TS2345: `bang` does not put that one · task.replay! task.blockedSegment! wherever React knows which kind of task it holds
