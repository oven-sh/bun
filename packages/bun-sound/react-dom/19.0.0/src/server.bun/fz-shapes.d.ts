// fz-shapes.d.ts: the shapes of react-dom 19.0.0, cjs/react-dom-server.bun.production.js (Fizz). CARRIED OVER FROM 19.1.0's AND MENDED. READ OFF THIS BUNDLE'S OWN BIRTHS:
// the members of an interface stand in the order in which the birth STORES them (a chain this.a = this.b = 0 stores b first).
// "birth NNNN" = line of original.js. "given" = the value is made elsewhere (react, react-dom, Bun, the user).
// CHECKED BY PROGRAM (python3 shapes_check.py): the births named behind the heads have their interface's members, in its order; no two births of one interface differ; every FZ name the pieces use is declared.
// THE CHECKER DOES NOT LOOK INTO A .d.ts (it says "0 files"; a name that does not exist there is silently any): shapes_check.py checks all fz-shapes*.d.ts as .ts, and the births again. births.txt (python3 births.py): every birth of this bundle.
// WHAT 19.1.0 HAS AND THIS VERSION HAS NOT: THE PREAMBLE, WHOLE:
//   PreambleState, PreambleContribution · RenderState.preamble (htmlChunks and headChunks are RenderState's OWN members here: 260 261; there is no bodyChunks) · Request.completedPreambleSegments · Task.blockedPreamble
//   Segment.preambleChildren · SuspenseBoundary.contentPreamble | fallbackPreamble · the insertion mode HTML_HEAD (the modes behind HTML are one lower here: InsertionMode)
//   createPreambleState pushStartSingletonElement hoistPreambleState writePreambleContribution preparePreambleFromSubtree preparePreambleFromSegment preparePreamble (7 functions: 137 here, 144 there)
// WHAT THIS VERSION HAS AND 19.1.0 HAS NOT: ClassComponentUpdater.isMounted (the first member: 2826).
// WHAT STANDS OTHERWISE THAN IN 19.1.0: Segment: id and index AHEAD OF parentFlushed (3687) · Dispatcher: the four behind useSyncExternalStore in another order, and useFormState | useActionState
//   are not in the literal: stored BEHIND the birth (3239 3240): optional members, the last two · PreloadHeaders is born INSIDE RenderState's literal (267), not ahead of it.
// WHAT 19.2.8 HAS AND THIS VERSION HAS NOT:
//   SuspenseListRow, Task.row, SuspenseBoundary.row (<SuspenseList> renders its children like a fragment here: 3998) · Request.byteSize · RenderState.startInlineStyle · NoncePair (RenderState.nonce is options.nonce itself)
//   FormatContext.viewTransition, ViewTransitionContext (<ViewTransition> is not named here at all) · HoistableState.suspenseyImages · Dispatcher.useEffectEvent · AsyncDispatcher.cacheSignal
//   trackPostpone | trackPostponedBoundary | addToReplayParent (no SlotMap and no ReplayNode of 6 is born) · byteLengthOfChunk (SuspenseBoundary.byteSize stays 0; Buffer is not named) · the second birth of ComponentStackNode ("Suspense Fallback").
// WHAT THIS VERSION HAS AND 19.2.8 HAS NOT: Task.isFallback (the last member).
declare namespace FZ {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; a value that is no int32 stored there is a TypeError at run time.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = number;
  type RequestStatus = int32; // Request.status: 10 OPENING 11 OPEN 12 ABORTING 13 CLOSING 14 CLOSED
  type SegmentStatus = int32; // Segment.status: 0 PENDING 1 COMPLETED 2 FLUSHED 3 ABORTED 4 ERRORED 5 POSTPONED (tested 4917 5146 5348, never stored) 6 RENDERING
  type BoundaryStatus = int32; // SuspenseBoundary.status: 0 PENDING 1 COMPLETED 4 CLIENT_RENDERED
  type StylesheetState = int32; // StylesheetResource.state: 0 PENDING 1 PRELOADED 2 PREAMBLE 3 LATE
  type InsertionMode = int32; // 0 ROOT_HTML 1 HTML_HTML 2 HTML 3 SVG 4 MATHML 5 TABLE 6 TABLE_BODY 7 TABLE_ROW 8 COLGROUP (437..485 1970 2033). NO HTML_HEAD HERE: 19.1.0's 4..9 are 3..8
  type TagScope = int32; // bits: 1 NOSCRIPT (451) 2 PICTURE (461)
  type InstructionState = int32; // bits: 1 $RS (5327) 2 $RC (5285) 4 $RX (5445) 8 $RR (5278) 16 form replay (803)
  type SegmentId = int32; // Segment.id, SuspenseBoundary.rootSegmentID, Request.nextSegmentId: -1 = none yet
  type ChildIndex = int32; // Task.childIndex: -1 = not a child of an array
  type TaskCount = int32; // every pendingTasks | allPendingTasks | pendingRootTasks
  type ChunkIndex = int32; // Segment.index, a length of chunks | children
  type TreeId = int32; // TreeContext.id: made by << | & alone
  type ContextDepth = int32;
  type HookCounter = int32; // localIdCounter actionStateCounter actionStateMatchingIndex (-1) thenableIndexCounter numberOfReRenders
  type ByteSize = int32; // SuspenseBoundary.byteSize: 0 AT THE BIRTH (3585) AND NEVER STORED AGAIN IN THIS BUNDLE (19.2.8 adds Buffer.byteLength to it: a number there); read once: > progressiveChunkSize (5211)
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
  type IteratorFn = any; // node[Symbol.iterator] (null when none: no getIteratorFn here, it is inlined: 4462), and the iterator and steps it gives
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
  type PropsBag = { [name: string]: any }; // props MADE here: {} 3809 4152 · 306 358 (members are ADDED behind the birth) · every first argument and result of assign()
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag; // var assign: so that its literal first arguments are checked as dictionaries
  type NameCache = { [name: string]: boolean }; // births 51 52
  type PreloadState = PropValue[]; // [] (PRELOAD_NO_CREDS 220, one array, compared by .length) | [crossOrigin, integrity] births 2446 2464 2523 4893
  type ResourceDict = { [key: string]: PreloadState | null }; // null = Exists. births 276 279 280 423..425 427 2474 2531
  type ExistsDict = { [key: string]: null }; // births 277 278 421 422
  type UnknownResourceDict = { [as: string]: ResourceDict }; // births 420 426
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict }; // births 278 422: { default, anonymous, credentials }: only ever read as [bucket]
  type SlotMap = { [index: string]: SegmentId | undefined }; // NO BIRTH AND NO STORE in this bundle (19.2.8's trackPostpone makes them); READ FOR EVERY CHILD INDEX, also those without a slot (4578), and told apart by "number" === typeof (4579): undefined = absent; members are deleted as they are resumed (4581 4793)
  type ThrownInfo = { [name: string]: unknown }; // births 3709 4902 5130 5592 5657: {}; componentStack is an ACCESSOR put by Object.defineProperty (3711). Only handed to onError

  // TUPLES: arrays the bundle builds; JSON.stringify sees the first (useActionState 3095 3118).
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex]; // births 4047 4135 4278 4426 4520
  /**
   * birth 4048 (4 long). NONE OF 6 IS BORN HERE (19.2.8's trackPostponedBoundary makes them): the text that reads them is here all the same (4348 4352 4354 4770). ONE TYPE: a 6 is made a 4 by .length = 4 (4601).
   * 4 === node.length (4286 4760) tells them apart but does not narrow: node[4]! node[5]! in the other branch.
   */
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null; // null nothing · a number: resume at the root position · a map: child index -> segment id
  type ThenableState = Thenable[]; // birth 3141
  type MemoState = [value: any, deps: HookDeps]; // birth 3050, in Hook.memoizedState
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null]; // births 3008 3010 3027
  type OptimisticTuple = [state: HookState, dispatch: Dispatch]; // birth 3236
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void]; // birth 3193
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean]; // births 3127 3130
  type ComponentFrameSample = [sample: string | null, control: string | null]; // births 3311 3313

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Request
  // -------------------------------------------------------------------------------------------------------------------
  interface Request { // birth 3470 RequestInstance
    destination: Destination; // null when none
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number; // 12800 | options.progressiveChunkSize (given: React's type says number)
    status: RequestStatus;
    fatalError: Thrown; // null until fatalError() | abort()
    nextSegmentId: SegmentId;
    allPendingTasks: TaskCount;
    pendingRootTasks: TaskCount;
    completedRootSegment: Segment | null;
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
  /** function RequestInstance(this: FZ.Request, ..) and new (RequestInstance as unknown as FZ.RequestConstructor)(..) */
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
  }
  type ErrorHandler = (error: Thrown, errorInfo: ThrownInfo) => any; // the user's, or defaultErrorHandler. The result: a digest; what is no string | null | undefined is dropped
  type ErrorDigest = string | null | undefined; // logRecoverableError's result
  type PostponeHandler = (reason: string, postponeInfo: ThrownInfo) => void; // options.onPostpone (the user's), or noop: stored by RequestInstance (3502), never read in this bundle

  // -------------------------------------------------------------------------------------------------------------------
  // 5. Task, Segment, SuspenseBoundary
  // -------------------------------------------------------------------------------------------------------------------
  /** React's RenderTask (3614: replay null, blockedSegment a Segment) and ReplayTask (3657: replay a ReplaySet, blockedSegment null): THE SAME MEMBERS IN THE SAME ORDER, and resumeNode (4240 4250) turns one into the other and back: ONE SHAPE */
  interface Task { // birth 3614 3657
    replay: ReplaySet | null;
    node: ReactNode;
    childIndex: ChildIndex;
    ping: () => void; // handed to thenable.then(ping, ping)
    blockedBoundary: SuspenseBoundary | null; // null = the root
    blockedSegment: Segment | null;
    hoistableState: HoistableState | null;
    abortSet: Set<Task>;
    keyPath: KeyNode | null; // null = the root
    formatContext: FormatContext;
    context: ContextNode | null;
    treeContext: TreeContext;
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
    isFallback: boolean; // never stored again: !1 the root (3559) · !0 a boundary's fallback (4140 4431) · else the parent task's
  }
  interface Segment { // birth 3687
    status: SegmentStatus;
    id: SegmentId;
    index: ChunkIndex; // where in the parent's chunks it goes
    parentFlushed: boolean;
    chunks: Chunk[];
    children: Segment[];
    parentFormatContext: FormatContext;
    boundary: SuspenseBoundary | null;
    lastPushedText: boolean;
    textEmbedded: boolean;
  }
  interface SuspenseBoundary { // birth 3579
    status: BoundaryStatus;
    rootSegmentID: SegmentId;
    parentFlushed: boolean;
    pendingTasks: TaskCount;
    completedSegments: Segment[];
    byteSize: ByteSize; // 0 throughout
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    trackedContentKeyPath: KeyNode | null;
    trackedFallbackNode: ReplayNode | null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Postponing and replaying. DEAD IN THIS BUNDLE, AND STILL ITS TEXT: nothing stores Request.trackedPostpones (null at the birth: 3500), no task is born
  //    with a replay but from a task that has one (createReplayTask's callers: 4413 4604): the code that reads them is typed all the same.
  // -------------------------------------------------------------------------------------------------------------------
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots } // NO BIRTH in this bundle (19.3.0's createPrerenderRequest makes it); workingMap alone is read (4049 4599)
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: TaskCount } // birth 4298 4371 4416 4532

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The DOM side: RenderState, ResumableState, FormatContext, resources
  // -------------------------------------------------------------------------------------------------------------------
  interface RenderState { // birth 255
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    htmlChunks: Chunk[] | null; // null until <html> is pushed at the root (1878); read 1876 1880 5350
    headChunks: Chunk[] | null; // null until <head> is pushed (1860); read 1859 1862 5351
    externalRuntimeScript: null; // never stored again, never read
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | undefined; // onHeadersImpl (5616) or undefined: never stored again
    headers: PreloadHeaders | null; // null once they are emitted (4851)
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
  type OnHeaders = (headers: PropsBag) => void; // is handed { Link } or {} (4898)
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity } // birth 267
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict } // birth 275
  interface PreloadMaps { // birth 292
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface ResumableState { // birth 410
    idPrefix: string; // "" | options.identifierPrefix (given: React's type says string)
    nextFormID: int32;
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
  interface FormatContext { // birth 431
    insertionMode: InsertionMode;
    selectedValue: SelectedValue; // null when none
    tagScope: TagScope;
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource> } // birth 2301
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> } // birth 1483 1635 2556
  interface StylesheetResource { state: StylesheetState; props: PropsBag } // birth 1490 2563: props is what assign() made

  // -------------------------------------------------------------------------------------------------------------------
  // 8. The stacks a task carries
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextNode { // birth 4185. React's ContextSnapshot = ContextNode | null
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType } // birth 3705
  interface TreeContext { id: TreeId; overflow: string } // birth 2840 2856 2864

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Hooks, the tables of functions handed to react and react-dom, classes
  // -------------------------------------------------------------------------------------------------------------------
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null } // birth 2960
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null } // birth 3021: last is never stored again, never read
  interface Update { action: HookState; next: Update | null } // birth 3061
  interface RefObject { current: any } // birth 3170: handed to the user, kept in Hook.memoizedState
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  /** births 3102 3132: a function; 3106 stores a member on the first */
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  /** var HooksDispatcher: FZ.Dispatcher = { .. }: the function expressions in it then need no annotation. react reads it by name off SharedInternals.H */
  interface Dispatcher { // birth 3148: 21 members in the literal. THE LAST TWO ARE OPTIONAL: useFormState and useActionState are not in the literal: they are stored behind the birth, at 3239 and 3240, in that order
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
    useCacheRefresh(): () => void;
    useMemoCache(size: number): any[];
    useHostTransitionStatus(): FormStatusNotPending;
    useOptimistic(passthrough: any, reducer?: GivenFunction): OptimisticTuple;
    useFormState?(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple; // OPTIONAL: not in the literal: stored behind the birth (3239)
    useActionState?(action: FormAction, initialState: any, permalink?: PropValue): ActionStateTuple; // OPTIONAL: not in the literal: stored behind the birth (3240)
  }
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any } // birth 3242: it throws
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
  interface ClassComponentUpdater { // birth 2825
    isMounted(inst?: ClassInstance): boolean; // !1 always; react 19 does not call it
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean } // birth 3831: stored by name to ClassInstance._reactInternals (3832), comes back as any (2830 2834)

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Small things
  // -------------------------------------------------------------------------------------------------------------------
  /** BORN EMPTY: {}. The one member says: there is no member: so that no other shape is assignable to it. Made for every function component rendered; compared by === (dispatchAction) */
  interface ComponentIdentity { readonly $$fzIdentity?: never } // birth 3752
  /** BORN EMPTY: {}. emptyContextObject: handed to the user's classes as their context */
  interface EmptyContext { readonly $$fzEmptyContext?: never } // birth 2757
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 3272 (not in births.txt)
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
// A. THE MODULE-LEVEL VARIABLES (88 declarators in 29 statements: HooksDispatcher has a statement of its own here). Not listed = a constant symbol | regular expression |
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
//  493 styleNameCache                              Map<string, FZ.Chunk>
//  941 validatedTagCache                           Map<string, FZ.Chunk>
// 1945 endTagCache                                 Map<string, FZ.Chunk>
// 2098 currentlyRenderingBoundaryHasStylesToHoist  boolean
// 2099 destinationHasCapacity                      boolean
// 2136 stylesheetFlushingQueue                     FZ.Chunk[]
// 2705 bind                                        inference
// 2757 emptyContextObject                          FZ.EmptyContext
// 2758 currentActiveSnapshot                       FZ.ContextNode | null
// 2825 classComponentUpdater                       FZ.ClassComponentUpdater
// 2840 emptyTreeContext                            FZ.TreeContext
// 2869 clz32                                       (x: number) => number
// 2870 log · 2871 LN2                              inference
// 2876 SuspenseException                           inference (Error)
// 2921 suspendedThenable                           FZ.Thenable            (null when none)
// 2934 objectIs                                    (x: FZ.ComparedValue, y: FZ.ComparedValue) => boolean
// 2935 currentlyRenderingComponent                 FZ.ComponentIdentity | null
// 2936 currentlyRenderingTask                      FZ.Task | null
// 2937 currentlyRenderingRequest                   FZ.Request | null
// 2938 currentlyRenderingKeyPath                   FZ.KeyNode | null
// 2939 firstWorkInProgressHook                     FZ.Hook | null
// 2940 workInProgressHook                          FZ.Hook | null
// 2941 isReRender · 2942 didScheduleRenderPhaseUpdate   boolean
// 2943 localIdCounter · 2944 actionStateCounter · 2945 actionStateMatchingIndex · 2946 thenableIndexCounter   FZ.HookCounter
// 2947 thenableState                               FZ.ThenableState | null
// 2948 renderPhaseUpdates                          Map<FZ.UpdateQueue, FZ.Update> | null
// 2949 numberOfReRenders                           FZ.HookCounter
// 3148 HooksDispatcher                             FZ.Dispatcher
// 3241 currentResumableState                       FZ.ResumableState | null
// 3242 DefaultAsyncDispatcher                      FZ.AsyncDispatcher
// 3247 prefix · 3248 suffix                        string | undefined
// 3265 reentry                                     boolean                (inference gives it)
// 3565 currentRequest                              FZ.Request | null
// 19.2.8's currentlyFlushingRenderState, flushedByteSize and flushingPartialBoundaries are not here.

// ---------------------------------------------------------------------------------------------------------------------
// B. A PARAMETER'S NAME SAYS ITS TYPE, in all 137 functions, so that the 9 pieces agree. THE TYPE THAT ARRIVES (rule 4a's name$given).
//    READ OFF THE PIECES BY PROGRAM at the end of round 1: no parameter of a top-level function is bare.
// ---------------------------------------------------------------------------------------------------------------------
// request request$jscomp$0 request$jscomp$2   FZ.Request
// task                                        FZ.Task
// destination                                 FZ.Destination
// target target$jscomp$0                      FZ.Chunk[]             (adoptPreloadCredentials: FZ.PropsBag)
// renderState · resumableState                FZ.RenderState · FZ.ResumableState
// formatContext parentContext parentFormatContext rootFormatContext   FZ.FormatContext
// hoistableState                              FZ.HoistableState | null   (never null: writeHoistablesForBoundary writeStyleResourceDependenciesInJS flushSegmentContainer)
// segment                                     FZ.Segment             (finishedTask: | null)
// boundary                                    FZ.SuspenseBoundary    (| null: createPendingSegment abortRemainingReplayNodes finishedTask)
// blockedBoundary · blockedSegment            FZ.SuspenseBoundary | null · FZ.Segment
// abortSet fallbackAbortableTasks             Set<FZ.Task>
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
//   writeHoistablesForBoundary is
//   flushSubtree flushSegment flushSegmentContainer flushCompletedBoundary flushPartiallyCompletedSegment
// null: pushLinkImpl pushSelfClosing pushTitleImpl pushScriptImpl defaultErrorHandler
// FZ.ReactNode: pushStartGenericElement pushStartInstance renderWithHooks
// FZ.FulfilledValue: trackUsedThenable · FZ.UsedValue: unwrapThenable · FZ.HookState: basicStateReducer · FZ.MemoValue: useMemo
// sanitizeURL<T>(url: T): T | string
// getCustomFormFields: FZ.CustomFormFields · pushFormActionAttribute: FZ.FormDataGiven
// createRenderState: FZ.RenderState · createResumableState: FZ.ResumableState · createHoistableState: FZ.HoistableState
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
// 3327 3727 { value } 3279 { set } 3711 { configurable, enumerable, get } -> Object.defineProperty
// 4898 { Link } | {} -> onHeaders · 5643 { type, pull, cancel } 5667 { highWaterMark } -> ReadableStream
// 1802 4877 -> getPreloadAsHeader's params (for..in) · 1817 2175 2331 2381 -> pushLinkImpl's props (for..in) · 1492 { data-precedence, precedence } -> a source of assign()
// DICTIONARIES, NOT LAYOUTS (section 3): 306 358 and the first arguments of assign (1492 1561 2425 2439 2457 2491 2536 2566 2593 2619 3815 3844 3886): FZ.PropsBag ·
//   278 422 { default, anonymous, credentials }: FZ.ConnectResources

// ---------------------------------------------------------------------------------------------------------------------
// E. THE VARIABLES THAT HOLD TWO OR MORE KINDS OF OBJECT. p = a parameter (rule 4a) · l = a local (rule 4c: a marked variable a role).
//    `a > b` = holds a, later b. given = any. What is not listed holds one kind of object at most, beside numbers | strings | booleans | null | undefined.
//    A variable that STARTS as any (var key = node.key) stays any for the checker: a born literal stored to it is checked against nothing: split that role off too.
//    E1: WHAT WAS FOUND IN 19.2.8 AND HELD IN 19.1.0. 112 OF THE 137 FUNCTIONS HAVE 19.1.0's TEXT TO THE LETTER (compared by program). Of those named in E1 three differ: preload completeShell completeAll:
//        one line taken out of each, no store in it: the roles hold.
//    E2: THE 25 FUNCTIONS WHOSE TEXT DIFFERS FROM 19.1.0's (none is here alone). createRenderState and describeComponentStackByType are read off THIS text below. FOR THE OTHERS, AND FOR EVERY FUNCTION THAT E1 DOES NOT NAME,
//        THE ROLES ARE THOSE MARKED IN parts/NN.cts, AND splits.py IS THEIR JUDGE: another version's list is no guide: the minifier shares the names otherwise. The 25:
//        createRenderState createRootFormatContext getChildFormatContext pushStartInstance writeStartSegment writeEndSegment preload getComponentNameFromType describeComponentStackByType RequestInstance
//        createRequest createSuspenseBoundary createRenderTask createReplayTask createPendingSegment renderElement retryNode spawnNewSuspendedRenderTask abortRemainingReplayNodes completeShell completeAll
//        finishedTask performWork flushSegment flushCompletedQueues
// ---------------------------------------------------------------------------------------------------------------------
// E1
// writeBootstrap p renderState > Chunk[], l i int32 > Chunk · preloadLateStyle p stylesheet > int32
// prefetchDNS preconnect preload   l resumableState ResumableState > PreloadHeaders | null (> Resource in preload) · l header string > Resource (prefetchDNS)
//   l bucket ConnectBucket > Resource (preconnect) · l imageSrcSet given > Resource > ResourceDict (preload) · p href given > PropsBag (2491)
// preloadModule l as string > Resource
// preinitStyle p precedence given > StylesheetResource (2563), l renderState RenderState > Resource | undefined
// preinitScript preinitModuleScript   p src given > Resource | undefined > Resource · p options given > PropsBag
// useReducer p reducer Reducer > state > UpdateQueue (3021) > Dispatch · p initialArg given > Dispatch | null · p init > Update | undefined | null · l queue UpdateQueue | null > state
// dispatchAction p componentIdentity ComponentIdentity > Update (3061) · p action given > Update | undefined · p queue UpdateQueue > Update
// HooksDispatcher.useRef initialValue given > RefObject (3170) · useActionState p action given > ActionDispatch (3102), l request Request | null > ReactFormState
// describeNativeComponentFrame l RunInRootFrame > int32 · l namePropDescriptor PropertyDescriptor | undefined > int32 · l Fake a function > boolean > given
// logRecoverableError p request > ErrorHandler, p error > the handler's result · completeShell completeAll p request > () => void
// renderWithHooks p request > ReactNode · finishFunctionComponent p keyPath KeyNode > TreeContext · p actionStateCount int32 > KeyNode | null · l segment Segment | null > Chunk[]
// renderNodeDestructive p node given > ComponentStackNode | null
// renderChildrenArray p request IS NOT STORED TO · p children ReactNode[] > ThrownInfo > ErrorDigest · p childIndex ChildIndex > ReplayNode[] > int32 > given · l replay ReplaySet > TreeContext
//   l replayNodes ReplayNode[] > int32 · l j int32 > ResumeSlots > int32 · l node ReplayNode > ResumeSlots > given · l boundary SuspenseBoundary | null > SegmentId | undefined
// untrackBoundary p request > PostponedHoles | null · p boundary > KeyNode | null > ReplayNode | undefined
// E2
// createRenderState (once a request: cold)   p nonce IS NOT STORED TO (births.txt names it for the `nonce="` inside a string) · p externalRuntimeConfig given, never read > Chunk[] (238: RenderState.bootstrapChunks)
//   p importMap given > RenderState (255) · p onHeaders OnHeaders | undefined > int32 (the index of the first loop) > string | given (a module's src). (19.1.0: the other way round, and PreloadHeaders | null in importMap first: here it is born inside the literal: 267)
//   p maxHeadersLength given > string | given (a script's src) > string | undefined (a module's crossOrigin): all under any, no shape among them
//   l inlineScriptWithNonce string > string | undefined (a script's crossOrigin, a module's integrity): one union, no role · l idPrefix string > string | undefined (a script's integrity) > PropsBag (358)
//   l bootstrapScriptContent given > Chunk[] (248: importMapChunks) > PropsBag (306) > given (one of bootstrapModules) > ResumableState > Resource (381) · l bootstrapScripts given > int32 (the index of the second loop)
//   l scriptConfig given (one of bootstrapScripts) > ResumableState > Resource (329) > string | given (the second loop's key). 19.2.8's nonceStyle, inlineStyleWithNonce and bootstrapChunks are not here
// describeComponentStackByType p type given > string (3403: type$asFrame: a class component's frame, stored to the parameter and read back at once). ONLY THIS VERSION HAS THAT STORE: 19.1.0 returns the call itself

// ---------------------------------------------------------------------------------------------------------------------
// F. IDIOMS, probed on the checker
// ---------------------------------------------------------------------------------------------------------------------
// catch (x: FZ.Thrown) · new Set<FZ.Task>() (3483 4023 4361; 4773 takes it from the parameter) · new Map<FZ.KeyNode, FZ.ReplayNode>() comes by itself where the literal around it is typed
// an array literal becomes a tuple only against its type: a role declared FZ.KeyNode (4047 4278), a role declared FZ.ReplayNode (4048), a parameter or member of that type (4135 4426 4520)
// dict.hasOwnProperty(key) is Object's own method, not the index signature · delete slots[i] and for (var index in slots) pass on FZ.SlotMap · slots[i] reads as SegmentId | undefined BY THE ALIAS: no cast; "number" === typeof narrows both branches (the other dictionaries are only read behind hasOwnProperty: their values carry no undefined)
// var bucket: FZ.ConnectBucket | FZ.Resource · boundary.length = 4 passes on FZ.ReplayNode (4601)
// pushAllNext(newSnapshot!) (2815): TS2345: `bang` does not put that one · task.replay! task.blockedSegment! wherever React knows which kind of task it holds
