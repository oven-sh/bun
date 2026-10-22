// fz-shapes.d.ts: the shapes of react-dom 19.2.8, cjs/react-dom-server-legacy.browser.production.js (Fizz, the legacy bundle). READ OFF THE BUNDLE'S OWN BIRTHS
// (carried over from 19.3.0's shapes; where this version's birth has other members the interface is THIS version's, and says "19.2.8"):
// the members of an interface stand in the order in which the birth STORES them (a chain this.a = this.b = 0 stores b first).
// "birth NNNN" = line of original.js. "given" = the value is made elsewhere (react, react-dom, Bun, Node, the user).
// CHECKED BY PROGRAM (python3 shapes_check.py): the 43 births named behind the heads have their interface's members, in its order; no two births of one interface differ.
// THE CHECKER DOES NOT LOOK INTO A .d.ts (it says "0 files"; a name that does not exist there is silently any): python3 shapes_check.py checks all fz-shapes*.d.ts as .ts, and the births again.
declare namespace FZ {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; the build proves every value that is stored there, or stops.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = import("bun").int32;
  type RequestStatus = int32; // Request.status, 19.2.8: 10 OPENING 11 OPEN 12 ABORTING 13 CLOSING 14 CLOSED
  type SegmentStatus = int32; // Segment.status, 19.2.8: 0 PENDING 1 COMPLETED 2 FLUSHED 3 ABORTED 4 ERRORED 5 POSTPONED 6 RENDERING
  type BoundaryStatus = int32; // SuspenseBoundary.status: 0 PENDING 1 COMPLETED 4 CLIENT_RENDERED 5 POSTPONED
  type StylesheetState = int32; // StylesheetResource.state: 0 PENDING 1 PRELOADED 2 PREAMBLE 3 LATE
  type InsertionMode = int32; // 0 ROOT_HTML 1 HTML_HTML 2 HTML 3 HTML_HEAD 4 SVG 5 MATHML 6 TABLE 7 TABLE_BODY 8 TABLE_ROW 9 COLGROUP
  type TagScope = int32; // bits: 1 NOSCRIPT 2 PICTURE 4 FALLBACK 8 EXIT 16 ENTER 32 UPDATE 64 APPEARING
  type InstructionState = int32; // bits: 1 $RS 2 $RC 4 $RX 8 $RR 16 form replay 32 shell id 64 shell time 128 needs view transitions 256 sent them
  type SegmentId = int32; // Segment.id, SuspenseBoundary.rootSegmentID, Request.nextSegmentId: -1 = none yet
  type ChildIndex = int32; // Task.childIndex: -1 = not a child of an array
  type TaskCount = int32; // every pendingTasks | allPendingTasks | pendingRootTasks
  type ChunkIndex = int32; // Segment.index, a length of chunks | children
  type TreeId = int32; // TreeContext.id: made by << | & alone
  type ContextDepth = int32;
  type HookCounter = int32; // localIdCounter actionStateCounter actionStateMatchingIndex (-1) thenableIndexCounter numberOfReRenders
  type ByteSize = number; // sums of chunks' lengths by React's model: NOT int32 (the legacy bundle adds boundaries' to the request's and to flushedByteSize; no chunk is measured)
  type HeaderCapacity = number; // PreloadHeaders.remainingCapacity: NOT int32: the user's number

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
  type IteratorFn = any; // getIteratorFn's result (null when none), and the iterator and steps it gives
  type Destination = any; // renderToStringImpl's { push, destroy } (6573): read by name. null when none
  type Options = any; // the bag an exported function is handed; the bag of preload | preloadModule | preinit*
  type ReactFormState = any; // options.formState: [state, keyPath, referenceId, boundArgumentCount]. null when none
  type FormAction = any; // a server action: $$FORM_ACTION $$IS_SIGNATURE_EQUAL bind
  type CustomFormFields = any; // what $$FORM_ACTION gives: name action encType method target data. null when none
  type FormDataGiven = any; // null when none
  type Nonce = any; // options.nonce | .script | .style: a string or undefined by React's types; null and 0 get through
  type SelectedValue = any; // <select>'s value | defaultValue. null when none
  type ViewTransitionValue = any; // a prop of <ViewTransition> (or "auto" | "none" | an id made here): taken for a string, never tested
  type BootstrapScriptContent = any; // options.bootstrapScriptContent: string | undefined
  type BootstrapScripts = any; // options.bootstrapScripts | bootstrapModules: Array<string | { src, integrity, crossOrigin }> | undefined
  type ReactModule = any; // require("react"): Children version __CLIENT_INTERNALS..
  type ReactDOMModule = any; // require("react-dom")
  type SharedInternals = any; // react's { H, A, T, S .. }: H and A are stored by name (performWork)
  type DOMSharedInternals = any; // react-dom's { d, p, findDOMNode }: d is stored by name (295)
  type HostDispatcherGiven = any; // previousDispatcher: react-dom's own { f r D C L m X S M }
  type GivenFunction = any;

  // -------------------------------------------------------------------------------------------------------------------
  // 3. Chunks, dictionaries, tuples
  // -------------------------------------------------------------------------------------------------------------------
  type Chunk = string; // the legacy bundle has no stringToChunk: a chunk IS the string: destination.push(chunk)
  type PrecomputedChunk = string; // no stringToPrecomputedChunk either
  type Resource = Chunk[]; // a <link> | <script> as chunks; emptied by .length = 0 when flushed or adopted

  // DICTIONARIES: born {} (or by Object.assign, or by JSON.parse) and read by a computed name: plain objects, no layout.
  type PropsBag = { [name: string]: any }; // props MADE here: {} 4196 4688 · 2757 2807 (members are ADDED behind the birth) · every first argument and result of assign()
  type Assign = (target: PropsBag, ...sources: any[]) => PropsBag; // var assign: so that its literal first arguments are checked as dictionaries
  type NameCache = { [name: string]: boolean }; // births 137 138
  type PreloadState = PropValue[]; // [] (PRELOAD_NO_CREDS 306, one array, compared by .length) | [crossOrigin, integrity] births 2457 2475 2534 5562
  type ResourceDict = { [key: string]: PreloadState | null }; // null = Exists. births 332..334 336 2485 2542 2862 2865 2866
  type ExistsDict = { [key: string]: null }; // births 330 331 2863 2864
  type UnknownResourceDict = { [as: string]: ResourceDict }; // births 329 335
  type ConnectBucket = "default" | "anonymous" | "credentials";
  type ConnectResources = { [bucket: string]: ExistsDict }; // births 331 2864: { default, anonymous, credentials }: only ever read as [bucket]
  type SlotMap = { [index: string]: SegmentId | undefined }; // births 5195 5205 5210; stored: segment.id alone (5213); READ FOR EVERY CHILD INDEX, also those without a slot, and told apart by "number" === typeof (4050 5110): undefined = absent; members are deleted as they are resumed (4052 5112 5437)
  type ThrownInfo = { [name: string]: unknown }; // births 3930 5571 5888 6499 6525: {}; componentStack is an ACCESSOR put by Object.defineProperty. Only handed to onError

  // TUPLES: arrays the bundle builds; JSON.stringify sees the first (useActionState) and the second (the postponed state).
  type KeyNode = [parent: KeyNode | null, name: ComponentName, keyOrIndex: KeyOrIndex]; // births 4535 4808 5053
  /**
   * births 4536 5189 5206 6534 (4 long) 5135 (6 long). ONE TYPE: the bundle makes a 4 into a 6 by stores (5147 5148) and a 6 into a 4 by .length = 4 (5224).
   * 4 === node.length tells them apart but does not narrow: node[4]! node[5]! in the other branch.
   */
  type ReplayNode = [name: ComponentName, keyOrIndex: KeyOrIndex, children: ReplayNode[], slots: ResumeSlots, fallback?: ReplayNode | null, rootSegmentID?: SegmentId];
  type ResumeSlots = SlotMap | SegmentId | null; // null nothing · a number: resume at the root position · a map: child index -> segment id
  type ThenableState = Thenable[]; // birth 3315
  type MemoState = [value: any, deps: HookDeps]; // birth 3222, in Hook.memoizedState
  type DispatchTuple = [state: HookState, dispatch: Dispatch | null]; // births 3180 3182 3199
  type OptimisticTuple = [state: HookState, dispatch: Dispatch]; // birth 3393
  type TransitionTuple = [isPending: boolean, start: (callback?: GivenFunction) => void]; // birth 3367
  type ActionStateTuple = [state: HookState, dispatch: ActionDispatch, isPending: boolean]; // births 3301 3304
  type ComponentFrameSample = [sample: string | null, control: string | null]; // births 3486 3488

  // -------------------------------------------------------------------------------------------------------------------
  // 4. Request
  // -------------------------------------------------------------------------------------------------------------------
  interface Request { // birth 3662 RequestInstance
    destination: Destination; // null when none
    flushScheduled: boolean;
    resumableState: ResumableState;
    renderState: RenderState;
    rootFormatContext: FormatContext;
    progressiveChunkSize: number; // 12800 | what is handed over: Infinity at the one call of the legacy bundle (6557): NOT int32
    status: RequestStatus;
    fatalError: Thrown; // null until fatalError() | abort()
    nextSegmentId: number;
    allPendingTasks: number;
    pendingRootTasks: number;
    completedRootSegment: Segment | null;
    completedPreambleSegments: Segment[][] | null;
    byteSize: ByteSize;
    abortableTasks: Set<Task>;
    pingedTasks: Task[];
    clientRenderedBoundaries: SuspenseBoundary[];
    completedBoundaries: SuspenseBoundary[];
    partialBoundaries: SuspenseBoundary[];
    trackedPostpones: PostponedHoles | null; // null always in the legacy bundle: never stored again
    onError: ErrorHandler;
    onPostpone: PostponeHandler; // never called in this bundle
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
  // PostponeHandler (19.2.8: Request.onPostpone: the user's, or noop) stands in fz-shapes-05.d.ts: ONE declaration
  type ErrorDigest = string | null | undefined; // logRecoverableError's result

  // -------------------------------------------------------------------------------------------------------------------
  // 5. Task, Segment, SuspenseBoundary, SuspenseListRow
  // -------------------------------------------------------------------------------------------------------------------
  /** React's RenderTask (3824: replay null, blockedSegment a Segment) and ReplayTask (3869: replay a ReplaySet, blockedSegment null): THE SAME MEMBERS IN THE SAME ORDER, and resumeNode (4756) turns one into the other and back: ONE SHAPE */
  interface Task { // birth 3824 3869
    replay: ReplaySet | null;
    node: ReactNode;
    childIndex: ChildIndex;
    ping: Ping;
    blockedBoundary: SuspenseBoundary | null; // null = the root
    blockedSegment: Segment | null;
    blockedPreamble: PreambleState | null;
    hoistableState: HoistableState | null;
    abortSet: Set<Task>;
    keyPath: KeyNode | null; // null = the root
    formatContext: FormatContext;
    context: ContextNode | null;
    treeContext: TreeContext;
    row: SuspenseListRow | null;
    componentStack: ComponentStackNode | null;
    thenableState: ThenableState | null;
  }
  type Ping = () => void; // 19.2.8: a FUNCTION (3828 3873), no record: handed to thenable.then(ping, ping)
  interface Segment { // birth 3900
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
  interface SuspenseBoundary { // birth 3773
    status: BoundaryStatus;
    rootSegmentID: number;
    parentFlushed: boolean;
    pendingTasks: number;
    row: SuspenseListRow | null;
    completedSegments: Segment[];
    byteSize: ByteSize;
    fallbackAbortableTasks: Set<Task>;
    errorDigest: ErrorDigest;
    contentState: HoistableState;
    fallbackState: HoistableState;
    contentPreamble: PreambleState | null; // 19.2.8: these four members stand in the boundary itself: no BoundaryPreamble, no TrackedBoundary. null at all three calls of the legacy bundle (4505 4893 5414)
    fallbackPreamble: PreambleState | null; // likewise
    trackedContentKeyPath: KeyNode | null; // born null; stored 4513
    trackedFallbackNode: ReplayNode | null; // born null; stored 4538
  }
  interface SuspenseListRow { // birth 4013
    pendingTasks: number;
    boundaries: SuspenseBoundary[] | null;
    hoistables: HoistableState;
    inheritedHoistables: HoistableState | null;
    together: boolean;
    next: SuspenseListRow | null;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. Postponing and replaying. THE LEGACY BUNDLE NEVER POSTPONES AND NEVER RESUMES: Request.trackedPostpones is born null and never stored again,
  //    no task is born with a replay from outside: the code for both is in the text all the same, and is typed.
  // -------------------------------------------------------------------------------------------------------------------
  interface PostponedHoles { workingMap: Map<KeyNode, ReplayNode>; rootNodes: ReplayNode[]; rootSlots: ResumeSlots } // NO BIRTH in the legacy bundle
  interface ReplaySet { nodes: ReplayNode[]; slots: ResumeSlots; pendingTasks: number } // birth 4824 4910 4950 5065

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The DOM side: RenderState, ResumableState, FormatContext, resources
  // -------------------------------------------------------------------------------------------------------------------
  interface RenderState { // birth 2849
    placeholderPrefix: PrecomputedChunk;
    segmentPrefix: PrecomputedChunk;
    boundaryPrefix: PrecomputedChunk;
    startInlineScript: PrecomputedChunk;
    startInlineStyle: PrecomputedChunk;
    preamble: PreambleState;
    externalRuntimeScript: null; // never stored again, never read
    bootstrapChunks: Chunk[];
    importMapChunks: Chunk[];
    onHeaders: OnHeaders | null | undefined; // undefined at the birth, never stored again: read once (5516)
    headers: PreloadHeaders | null; // null at the birth, never a PreloadHeaders in the legacy bundle
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
    nonce: NoncePair;
    stylesToHoist: boolean;
    generateStaticMarkup: boolean; // THE LEGACY BUNDLE's OWN RenderState: no hoistableState; this member last
  }
  type OnHeaders = (headers: PropsBag) => void; // is handed { Link } (5567) or {}
  interface PreloadHeaders { preconnects: string; fontPreloads: string; highImagePreloads: string; remainingCapacity: HeaderCapacity } // NO BIRTH in the legacy bundle
  interface ResourceResets { font: ResourceDict; dns: ExistsDict; connect: ConnectResources; image: ResourceDict; style: ResourceDict } // birth 2861
  interface PreloadMaps { // birth 2745
    images: Map<string, Resource>;
    stylesheets: Map<string, Resource>;
    scripts: Map<string, Resource>;
    moduleScripts: Map<string, Resource>;
  }
  interface NoncePair { script: Nonce; style: Nonce } // birth 2879
  interface ResumableState { // birth 319
    idPrefix: string; // "" | options.identifierPrefix (given: React's type says string)
    nextFormID: number;
    streamingFormat: int32; // 0, never read
    bootstrapScriptContent?: BootstrapScriptContent; // undefined at the one call of the legacy bundle (6551). OPTIONAL as in the other bundles' ResumableState
    bootstrapScripts?: BootstrapScripts; // likewise
    bootstrapModules?: BootstrapScripts; // likewise
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
  interface PreambleState { htmlChunks: Chunk[] | null; headChunks: Chunk[] | null; bodyChunks: Chunk[] | null } // birth 2855
  interface FormatContext { // birth 345
    insertionMode: InsertionMode;
    selectedValue: SelectedValue; // null when none
    tagScope: TagScope;
    viewTransition: ViewTransitionContext | null;
  }
  interface ViewTransitionContext { // birth 404: 19.2.8: no parentEnter, no parentExit. The one birth copies another: FormatContext.viewTransition is null at every other call: none is ever made in the legacy bundle
    update: ViewTransitionValue;
    enter: ViewTransitionValue;
    exit: ViewTransitionValue;
    share: ViewTransitionValue;
    name: ViewTransitionValue;
    autoName: ViewTransitionValue;
    nameIdx: int32;
  }
  interface HoistableState { styles: Set<StyleQueue>; stylesheets: Set<StylesheetResource>; suspenseyImages: boolean } // birth 2311
  interface StyleQueue { precedence: Chunk; rules: Chunk[]; hrefs: Chunk[]; sheets: Map<string, StylesheetResource> } // birth 1441 1593 2567
  interface StylesheetResource { state: StylesheetState; props: PropsBag } // birth 1448 2574: props is what assign() made

  // -------------------------------------------------------------------------------------------------------------------
  // 8. The stacks a task carries
  // -------------------------------------------------------------------------------------------------------------------
  interface ContextNode { // birth 4719. React's ContextSnapshot = ContextNode | null
    parent: ContextNode | null;
    depth: ContextDepth;
    context: ReactContext;
    parentValue: ContextValue;
    value: ContextValue;
  }
  interface ComponentStackNode { parent: ComponentStackNode | null; type: ElementType } // birth 3919 3927 (type "Suspense Fallback")
  interface TreeContext { id: TreeId; overflow: string } // birth 3020 3036 3044

  // -------------------------------------------------------------------------------------------------------------------
  // 9. Hooks, the tables of functions handed to react and react-dom, classes
  // -------------------------------------------------------------------------------------------------------------------
  interface Hook { memoizedState: HookState; queue: UpdateQueue | null; next: Hook | null } // birth 3132
  interface UpdateQueue { last: Update | null; dispatch: Dispatch | null } // birth 3193: last is never stored again, never read
  interface Update { action: HookState; next: Update | null } // birth 3230
  interface RefObject { current: any } // birth 3344: handed to the user, kept in Hook.memoizedState
  type Dispatch = (action: any) => void;
  type Reducer = (state: any, action: any) => any;
  /** births 3275 3306: a function; 3279 stores a member on the first */
  interface ActionDispatch { (payload: any): void; $$FORM_ACTION?: (prefix: any) => CustomFormFields }
  /** var HooksDispatcher: FZ.Dispatcher = { .. }: the function expressions in it then need no annotation. react reads it by name off SharedInternals.H */
  interface Dispatcher { // birth 3321
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
    useEffectEvent(callback?: GivenFunction): () => void;
  }
  interface AsyncDispatcher { getCacheForType(resourceType?: GivenFunction): any; cacheSignal(): any } // birth 3414: both throw
  interface FormStatusNotPending { pending: boolean; data: null; method: null; action: null } // birth 288: handed to the user
  /** stored by name to DOMSharedInternals.d: react-dom reads it by name */
  interface HostDispatcher { // birth 295
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
  interface ClassComponentUpdater { // birth 3008
    enqueueSetState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueReplaceState(inst: ClassInstance, payload: any, callback?: any): void;
    enqueueForceUpdate(inst?: ClassInstance, callback?: any): void;
  }
  interface InternalInstance { queue: any[] | null; replace: boolean } // birth 4218: stored by name to ClassInstance._reactInternals (4219), comes back as any (3010 3014)

  // -------------------------------------------------------------------------------------------------------------------
  // 10. Small things, and what is handed to the user
  // -------------------------------------------------------------------------------------------------------------------
  /** BORN EMPTY: {}. The one member says: there is no member: so that no other shape is assignable to it. Made for every function component rendered; compared by === (dispatchAction) */
  interface ComponentIdentity { readonly $$fzIdentity?: never } // birth 4139
  /** BORN EMPTY: {}. emptyContextObject: handed to the user's classes as their context */
  interface EmptyContext { readonly $$fzEmptyContext?: never } // birth 2952
  interface RunInRootFrame { DetermineComponentFrameRoot: { (): ComponentFrameSample; displayName?: string } } // birth 3447 (not in births.txt)
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals the bundle names and the checker's library (ES only) lacks. Delete this block when a real library is in.
// ---------------------------------------------------------------------------------------------------------------------
declare var require: (name: string) => any;
declare var exports: any;
declare var console: { error(...data: any[]): void };

// ---------------------------------------------------------------------------------------------------------------------
// A. THE MODULE-LEVEL VARIABLES (88 declarators). Not listed = a constant symbol | regular expression | string: leave it to inference
//    (the 18 REACT_*, MAYBE_ITERATOR_SYMBOL, the 12 patterns, actionJavaScriptURL). The others:
// ---------------------------------------------------------------------------------------------------------------------
//   36 React                                       FZ.ReactModule
//   37 ReactDOM                                    FZ.ReactDOMModule
//   78 isArrayImpl                                 inference (Array.isArray: a type guard to any[])
//  132 assign                                      FZ.Assign
//  133 hasOwnProperty                              inference
//  137 illegalAttributeNameCache                   FZ.NameCache
//  138 validatedAttributeNameCache                 FZ.NameCache
//  148 unitlessNumbers                             Set<string>            (inference gives it)
//  153 aliases                                     Map<string, string>    (inference gives it)
//  284 ReactSharedInternals                        FZ.SharedInternals
//  286 ReactDOMSharedInternals                     FZ.DOMSharedInternals
//  288 sharedNotPendingObject                      FZ.FormStatusNotPending
//  294 previousDispatcher                          FZ.HostDispatcherGiven
//  295 ReactDOMSharedInternals.d = { .. }          no variable: the literal goes into any: = { .. }/*$*/ as FZ.HostDispatcher/*$*/;
//  306 PRELOAD_NO_CREDS                            FZ.PreloadState
//  307 currentlyFlushingRenderState                FZ.RenderState | null
//  436 styleNameCache                              Map<string, FZ.Chunk>
//  903 validatedTagCache                           Map<string, FZ.Chunk>
// 1933 endTagCache                                 Map<string, FZ.Chunk>
// 2099 currentlyRenderingBoundaryHasStylesToHoist  boolean
// 2100 destinationHasCapacity                      boolean
// 2140 stylesheetFlushingQueue                     FZ.Chunk[]
// 2898 bind                                        inference
// 2952 emptyContextObject                          FZ.EmptyContext
// 2953 currentActiveSnapshot                       FZ.ContextNode | null
// 3008 classComponentUpdater                       FZ.ClassComponentUpdater
// 3020 emptyTreeContext                            FZ.TreeContext
// 3049 clz32                                       (x: number) => number
// 3050 log · 3051 LN2                              inference
// 3057 SuspenseException                           inference (Error)
// 3099 suspendedThenable                           FZ.Thenable            (null when none)
// 3109 objectIs                                    (x: any, y: any) => boolean
// 3110 currentlyRenderingComponent                 FZ.ComponentIdentity | null
// 3111 currentlyRenderingTask                      FZ.Task | null
// 3112 currentlyRenderingRequest                   FZ.Request | null
// 3113 currentlyRenderingKeyPath                   FZ.KeyNode | null
// 3114 firstWorkInProgressHook                     FZ.Hook | null
// 3115 workInProgressHook                          FZ.Hook | null
// 3116 isReRender · 3117 didScheduleRenderPhaseUpdate   boolean
// 3118 localIdCounter · 3119 actionStateCounter · 3120 actionStateMatchingIndex · 3121 thenableIndexCounter   FZ.HookCounter
// 3122 thenableState                               FZ.ThenableState | null
// 3123 renderPhaseUpdates                          Map<FZ.UpdateQueue, FZ.Update> | null
// 3124 numberOfReRenders                           FZ.HookCounter
// 3321 HooksDispatcher                             FZ.Dispatcher
// 3413 currentResumableState                       FZ.ResumableState | null
// 3414 DefaultAsyncDispatcher                      FZ.AsyncDispatcher
// 3422 prefix · 3423 suffix                        string | undefined
// 3440 reentry                                     boolean
// 3759 currentRequest                              FZ.Request | null
// 6013 flushedByteSize                             FZ.ByteSize
// 6202 flushingPartialBoundaries                   boolean

// ---------------------------------------------------------------------------------------------------------------------
// B. A PARAMETER'S NAME SAYS ITS TYPE, in all 157 functions, so that the 11 pieces agree. THE TYPE THAT ARRIVES (rule 4a's name$given).
// ---------------------------------------------------------------------------------------------------------------------
// request request$jscomp$0 request$jscomp$2   FZ.Request
// task                                        FZ.Task
// destination                                 FZ.Destination
// target target$jscomp$0                      FZ.Chunk[]             (adoptPreloadCredentials: FZ.PropsBag)
// renderState · resumableState                FZ.RenderState · FZ.ResumableState
// preambleState                               FZ.PreambleState       (pushStartInstance: | null)
// formatContext parentContext parentFormatContext rootFormatContext   FZ.FormatContext
// hoistableState                              FZ.HoistableState | null   (never null: writeHoistablesForBoundary writeStyleResourceDependenciesInJS flushSegmentContainer)
// parentState childState                      FZ.HoistableState
// inheritedHoistables                         FZ.HoistableState | null
// segment                                     FZ.Segment             (finishedTask: | null)
// boundary                                    FZ.SuspenseBoundary    (| null: createPendingSegment abortRemainingReplayNodes finishedTask)
// blockedBoundary · blockedSegment · blockedPreamble   FZ.SuspenseBoundary | null · FZ.Segment · FZ.PreambleState | null
// row previousRow unblockedRow                FZ.SuspenseListRow | null   (finishSuspenseListRow's row, togetherRow: never null)
// abortSet fallbackAbortableTasks             Set<FZ.Task>
// contentPreamble fallbackPreamble (createSuspenseBoundary, 19.2.8)   FZ.PreambleState | null
// keyPath                                     FZ.KeyNode             (createRenderTask createReplayTask: | null) · parentKeyPath: FZ.KeyNode | null
// context                                     FZ.ContextNode | null
// prev next · newSnapshot                     FZ.ContextNode · FZ.ContextNode | null
// treeContext baseContext                     FZ.TreeContext
// componentStack node$jscomp$0 (getThrownInfo)   FZ.ComponentStackNode | null
// thenableState                               FZ.ThenableState | null   (trackUsedThenable: never null)
// replay · nodes · slots                      FZ.ReplaySet · FZ.ReplayNode[] · FZ.ResumeSlots
// trackedPostpones                            FZ.PostponedHoles
// node                                        FZ.ReactNode           (addToReplayParent: FZ.ReplayNode)
// children                                    FZ.ReactNode           (renderChildrenArray: FZ.ReactNode[]) · rows: FZ.ReactNode (NOT an array type: the iterable itself may be handed over)
// props · type · ref                          FZ.Props · FZ.ElementType (string: getChildFormatContext pushStartInstance) · FZ.Ref
// Component · secondArg · fn                  FZ.FunctionComponent · FZ.Ref · FZ.ElementType
// styleQueue · stylesheet · resource          FZ.StyleQueue · FZ.StylesheetResource · FZ.Resource
// collectedPreambleSegments                   FZ.Segment[][]
// errorInfo · errorDigest$jscomp$0            FZ.ThrownInfo · FZ.ErrorDigest
// error reason                                FZ.Thrown              (renderToStringImpl's abortReason: string)
// thenable                                    FZ.Thenable
// options                                     FZ.Options
// value style innerHTML href as src crossOrigin precedence formEncType formMethod formTarget revealOrder
//   text url permalink initialState initialArg state action maybeIterable params key   FZ.PropValue or the nearer GIVEN alias: all any
// formAction · selectedValue · formState      FZ.FormAction · FZ.SelectedValue · FZ.ReactFormState   (createRequest, 19.2.8: formState?: its one call, 6552, hands over 11 of the 12; RequestInstance makes undefined null)
// identifierPrefix externalRuntimeConfig bootstrapScriptContent bootstrapScripts bootstrapModules   FZ.PropValue or the nearer GIVEN alias (off the options)
// progressiveChunkSize onError onAllReady onShellReady onShellError onFatalError onPostpone   as in FZ.RequestConstructor, IN THAT ORDER (19.2.8)
// name tag attributeName match prefix s suffix input   string   (FZ.PropValue: pushFormActionAttribute's and describeBuiltInComponentFrame's name)
// childIndex                                  FZ.ChildIndex
// id segmentId                                FZ.SegmentId
// index totalChildren                         FZ.int32 (createPendingSegment's index: FZ.ChunkIndex) · actionStateCount actionStateMatchingIndex: FZ.HookCounter · insertionMode: FZ.InsertionMode · tagScope: FZ.TagScope
// textEmbedded lastPushedText hasId construct shellComplete generateStaticMarkup   boolean
// viewTransition parentViewTransition         FZ.ViewTransitionContext | null
// preloadState                                FZ.PreloadState
// reducer · init · nextCreate · deps          FZ.Reducer · ((initialArg: any) => any) | undefined · () => any · FZ.HookDeps
// componentIdentity · queue                   FZ.ComponentIdentity · FZ.UpdateQueue
// x y                                         number (clz32Fallback) · any (is)
// `this`: FZ.Chunk[] pushAdditionalFormField · FZ.Destination flushStyleTagsLateForBoundary flushResource flushStyleInPreamble flushStylesInPreamble
//   preloadLateStyle preloadLateStyles · FZ.HoistableState hoistStyleQueueDependency hoistStylesheetDependency · FZ.Request abortTaskSoft RequestInstance

// ---------------------------------------------------------------------------------------------------------------------
// C. RESULTS that callers in other pieces lean on. Not listed = void, or plain to inference.
// ---------------------------------------------------------------------------------------------------------------------
// string: escapeTextForBrowser scriptReplacer styleReplacer escapeJS*ForInstructionScripts getPreloadAsHeader the two escape*Replacer flattenOptionChildren
//   describeBuiltInComponentFrame describeNativeComponentFrame describeComponentStackByType renderToStringImpl · FZ.ComponentName: getComponentNameFromType
// FZ.Chunk: startChunkForTag endChunkForTag · number: clz32Fallback murmurhash3_32_gc
// boolean: isAttributeNameSafe pushTextInstance writeBootstrap writeStartPendingSuspenseBoundary writeStartSegment writeEndSegment hasStylesToHoist
//   writeHoistablesForBoundary is isEligibleForOutlining preparePreambleFromSubtree preparePreambleFromSegment
//   flushSubtree flushSegment flushSegmentContainer flushCompletedBoundary flushPartiallyCompletedSegment
// null: pushLinkImpl pushSelfClosing pushTitleImpl pushScriptImpl defaultErrorHandler
// FZ.ReactNode: pushStartSingletonElement pushStartGenericElement pushStartInstance renderWithHooks · any under its alias: trackUsedThenable unwrapThenable basicStateReducer useMemo
// sanitizeURL<T>(url: T): T | string · getIteratorFn: FZ.IteratorFn
// getCustomFormFields: FZ.CustomFormFields · pushFormActionAttribute: FZ.FormDataGiven
// createRenderState: FZ.RenderState · createResumableState: FZ.ResumableState · createHoistableState: FZ.HoistableState
// createFormatContext getChildFormatContext getSuspenseFallbackFormatContext getSuspenseContentFormatContext: FZ.FormatContext
// getSuspenseViewTransition: FZ.ViewTransitionContext | null · pushTreeContext: FZ.TreeContext
// getSuspendedThenable: FZ.Thenable · getThenableStateAfterSuspending: FZ.ThenableState | null · resolveCurrentlyRenderingComponent: FZ.ComponentIdentity
// createHook createWorkInProgressHook: FZ.Hook · useReducer: FZ.DispatchTuple · useActionState: FZ.ActionStateTuple
// createRequest: FZ.Request
// createSuspenseBoundary: FZ.SuspenseBoundary · createRenderTask createReplayTask spawnNewSuspendedReplayTask spawnNewSuspendedRenderTask: FZ.Task
// createPendingSegment: FZ.Segment · createSuspenseListRow: FZ.SuspenseListRow
// replaceSuspenseComponentStackWithSuspenseFallbackStack: FZ.ComponentStackNode | null · getThrownInfo: FZ.ThrownInfo · logRecoverableError: FZ.ErrorDigest
// trackPostponedBoundary: FZ.ReplayNode
// renderNode renderNodeDestructive retryNode: void (they `return` the void of one another)

// ---------------------------------------------------------------------------------------------------------------------
// D. BIRTHS LEFT WITHOUT AN INTERFACE, ON PURPOSE: literals handed straight to a built-in, to given code, or to a for..in of ours, never stored to again.
// ---------------------------------------------------------------------------------------------------------------------
// 3454 { set } 3502 3948 { value } 3932 { configurable, enumerable, get } -> Object.defineProperty
// 5567 { Link } | {} -> onHeaders · 6573 { push, destroy } -> startFlowing's destination (any: read by name)
// 1766 5546 -> getPreloadAsHeader's params (for..in) · 1781 2180 2341 2391 -> pushLinkImpl's props (for..in) · 1450 { data-precedence, precedence } -> a source of assign()
// DICTIONARIES, NOT LAYOUTS (section 3): 2757 2807 and the first arguments of assign (1450 1520 2436 2450 2468 2502 2547 2577 2604 2630 4202 4231 4273): FZ.PropsBag ·
//   331 2864 { default, anonymous, credentials }: FZ.ConnectResources

// ---------------------------------------------------------------------------------------------------------------------
// E. THE VARIABLES THAT HOLD TWO OR MORE KINDS OF OBJECT: p = a parameter (rule 4a) · l = a local (rule 4c: a marked variable a role).
//    THE LIST OF 19.3.0's BUNDLE DOES NOT HOLD HERE (this version's compiler run reuses other variables: renderElement is one function here and reuses all six
//    of its parameters). THE TEXT ITSELF IS THE LIST: grep -n '\$given\|\$as[A-Z]' parts/*.cts ; births.txt's last section lists the 110 parameters that are stored to;
//    python3 splits.py all says whether every split is the bundle's own program.
//    A variable that STARTS as any (var key = node.key) stays any for the checker: a born literal stored to it is checked against nothing: split that role off too.
// ---------------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------------
// F. IDIOMS, probed on the checker
// ---------------------------------------------------------------------------------------------------------------------
// catch (x: FZ.Thrown) · new Set<FZ.Task>() (3675 4504 4892 5417) · new Map<FZ.KeyNode, FZ.ReplayNode>() comes by itself where the literal around it is typed
// an array literal becomes a tuple only against its type: a variable annotated FZ.KeyNode | FZ.ReplayNode, or a marked cast behind it
// dict.hasOwnProperty(key) is Object's own method, not the index signature · delete slots[i] and for (var index in slots) pass on FZ.SlotMap · slots[i] reads as SegmentId | undefined BY THE ALIAS: no cast; "number" === typeof narrows both branches (the other dictionaries are only read behind hasOwnProperty: their values carry no undefined)
// var bucket: FZ.ConnectBucket | FZ.Resource · boundary.length = 4 passes on FZ.ReplayNode (5224)
// pushAllNext(newSnapshot!) (2998): TS2345: `bang` does not put that one · task.replay! task.blockedSegment! wherever React knows which kind of task it holds
