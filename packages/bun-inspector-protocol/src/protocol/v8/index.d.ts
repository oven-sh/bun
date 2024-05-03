// GENERATED - DO NOT EDIT
export namespace V8 {
  export namespace Accessibility {
    /**
     * Unique accessibility node identifier.
     */
    export type AXNodeId = string;
    /**
     * Enum of possible property types.
     */
    export type AXValueType =
      | "boolean"
      | "tristate"
      | "booleanOrUndefined"
      | "idref"
      | "idrefList"
      | "integer"
      | "node"
      | "nodeList"
      | "number"
      | "string"
      | "computedString"
      | "token"
      | "tokenList"
      | "domRelation"
      | "role"
      | "internalRole"
      | "valueUndefined";
    /**
     * Enum of possible property sources.
     */
    export type AXValueSourceType = "attribute" | "implicit" | "style" | "contents" | "placeholder" | "relatedElement";
    /**
     * Enum of possible native property sources (as a subtype of a particular AXValueSourceType).
     */
    export type AXValueNativeSourceType =
      | "description"
      | "figcaption"
      | "label"
      | "labelfor"
      | "labelwrapped"
      | "legend"
      | "rubyannotation"
      | "tablecaption"
      | "title"
      | "other";
    /**
     * A single source for a computed AX property.
     */
    export type AXValueSource = {
      /**
       * What type of source this is.
       */
      type: AXValueSourceType;
      /**
       * The value of this property source.
       */
      value?: AXValue | undefined;
      /**
       * The name of the relevant attribute, if any.
       */
      attribute?: string | undefined;
      /**
       * The value of the relevant attribute, if any.
       */
      attributeValue?: AXValue | undefined;
      /**
       * Whether this source is superseded by a higher priority source.
       */
      superseded?: boolean | undefined;
      /**
       * The native markup source for this value, e.g. a `<label>` element.
       */
      nativeSource?: AXValueNativeSourceType | undefined;
      /**
       * The value, such as a node or node list, of the native source.
       */
      nativeSourceValue?: AXValue | undefined;
      /**
       * Whether the value for this property is invalid.
       */
      invalid?: boolean | undefined;
      /**
       * Reason for the value being invalid, if it is.
       */
      invalidReason?: string | undefined;
    };
    export type AXRelatedNode = {
      /**
       * The BackendNodeId of the related DOM node.
       */
      backendDOMNodeId: DOM.BackendNodeId;
      /**
       * The IDRef value provided, if any.
       */
      idref?: string | undefined;
      /**
       * The text alternative of this node in the current context.
       */
      text?: string | undefined;
    };
    export type AXProperty = {
      /**
       * The name of this property.
       */
      name: AXPropertyName;
      /**
       * The value of this property.
       */
      value: AXValue;
    };
    /**
     * A single computed AX property.
     */
    export type AXValue = {
      /**
       * The type of this value.
       */
      type: AXValueType;
      /**
       * The computed value of this property.
       */
      value?: unknown | undefined;
      /**
       * One or more related nodes, if applicable.
       */
      relatedNodes?: AXRelatedNode[] | undefined;
      /**
       * The sources which contributed to the computation of this property.
       */
      sources?: AXValueSource[] | undefined;
    };
    /**
     * Values of AXProperty name:
     * - from 'busy' to 'roledescription': states which apply to every AX node
     * - from 'live' to 'root': attributes which apply to nodes in live regions
     * - from 'autocomplete' to 'valuetext': attributes which apply to widgets
     * - from 'checked' to 'selected': states which apply to widgets
     * - from 'activedescendant' to 'owns' - relationships between elements other than parent/child/sibling.
     */
    export type AXPropertyName =
      | "busy"
      | "disabled"
      | "editable"
      | "focusable"
      | "focused"
      | "hidden"
      | "hiddenRoot"
      | "invalid"
      | "keyshortcuts"
      | "settable"
      | "roledescription"
      | "live"
      | "atomic"
      | "relevant"
      | "root"
      | "autocomplete"
      | "hasPopup"
      | "level"
      | "multiselectable"
      | "orientation"
      | "multiline"
      | "readonly"
      | "required"
      | "valuemin"
      | "valuemax"
      | "valuetext"
      | "checked"
      | "expanded"
      | "modal"
      | "pressed"
      | "selected"
      | "activedescendant"
      | "controls"
      | "describedby"
      | "details"
      | "errormessage"
      | "flowto"
      | "labelledby"
      | "owns";
    /**
     * A node in the accessibility tree.
     */
    export type AXNode = {
      /**
       * Unique identifier for this node.
       */
      nodeId: AXNodeId;
      /**
       * Whether this node is ignored for accessibility
       */
      ignored: boolean;
      /**
       * Collection of reasons why this node is hidden.
       */
      ignoredReasons?: AXProperty[] | undefined;
      /**
       * This `Node`'s role, whether explicit or implicit.
       */
      role?: AXValue | undefined;
      /**
       * This `Node`'s Chrome raw role.
       */
      chromeRole?: AXValue | undefined;
      /**
       * The accessible name for this `Node`.
       */
      name?: AXValue | undefined;
      /**
       * The accessible description for this `Node`.
       */
      description?: AXValue | undefined;
      /**
       * The value for this `Node`.
       */
      value?: AXValue | undefined;
      /**
       * All other properties
       */
      properties?: AXProperty[] | undefined;
      /**
       * ID for this node's parent.
       */
      parentId?: AXNodeId | undefined;
      /**
       * IDs for each of this node's child nodes.
       */
      childIds?: AXNodeId[] | undefined;
      /**
       * The backend ID for the associated DOM node, if any.
       */
      backendDOMNodeId?: DOM.BackendNodeId | undefined;
      /**
       * The frame ID for the frame associated with this nodes document.
       */
      frameId?: Page.FrameId | undefined;
    };
    /**
     * The loadComplete event mirrors the load complete event sent by the browser to assistive
     * technology when the web page has finished loading.
     * @event `Accessibility.loadComplete`
     */
    export type LoadCompleteEvent = {
      /**
       * New document root node.
       */
      root: AXNode;
    };
    /**
     * The nodesUpdated event is sent every time a previously requested node has changed the in tree.
     * @event `Accessibility.nodesUpdated`
     */
    export type NodesUpdatedEvent = {
      /**
       * Updated node data.
       */
      nodes: AXNode[];
    };
    /**
     * Disables the accessibility domain.
     * @request `Accessibility.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables the accessibility domain.
     * @response `Accessibility.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables the accessibility domain which causes `AXNodeId`s to remain consistent between method calls.
     * This turns on accessibility for the page, which can impact performance until accessibility is disabled.
     * @request `Accessibility.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables the accessibility domain which causes `AXNodeId`s to remain consistent between method calls.
     * This turns on accessibility for the page, which can impact performance until accessibility is disabled.
     * @response `Accessibility.enable`
     */
    export type EnableResponse = {};
    /**
     * Fetches the accessibility node and partial accessibility tree for this DOM node, if it exists.
     * @request `Accessibility.getPartialAXTree`
     */
    export type GetPartialAXTreeRequest = {
      /**
       * Identifier of the node to get the partial accessibility tree for.
       */
      nodeId?: DOM.NodeId | undefined;
      /**
       * Identifier of the backend node to get the partial accessibility tree for.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper to get the partial accessibility tree for.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
      /**
       * Whether to fetch this node's ancestors, siblings and children. Defaults to true.
       */
      fetchRelatives?: boolean | undefined;
    };
    /**
     * Fetches the accessibility node and partial accessibility tree for this DOM node, if it exists.
     * @response `Accessibility.getPartialAXTree`
     */
    export type GetPartialAXTreeResponse = {
      /**
       * The `Accessibility.AXNode` for this DOM node, if it exists, plus its ancestors, siblings and
       * children, if requested.
       */
      nodes: AXNode[];
    };
    /**
     * Fetches the entire accessibility tree for the root Document
     * @request `Accessibility.getFullAXTree`
     */
    export type GetFullAXTreeRequest = {
      /**
       * The maximum depth at which descendants of the root node should be retrieved.
       * If omitted, the full tree is returned.
       */
      depth?: number | undefined;
      /**
       * The frame for whose document the AX tree should be retrieved.
       * If omited, the root frame is used.
       */
      frameId?: Page.FrameId | undefined;
    };
    /**
     * Fetches the entire accessibility tree for the root Document
     * @response `Accessibility.getFullAXTree`
     */
    export type GetFullAXTreeResponse = {
      nodes: AXNode[];
    };
    /**
     * Fetches the root node.
     * Requires `enable()` to have been called previously.
     * @request `Accessibility.getRootAXNode`
     */
    export type GetRootAXNodeRequest = {
      /**
       * The frame in whose document the node resides.
       * If omitted, the root frame is used.
       */
      frameId?: Page.FrameId | undefined;
    };
    /**
     * Fetches the root node.
     * Requires `enable()` to have been called previously.
     * @response `Accessibility.getRootAXNode`
     */
    export type GetRootAXNodeResponse = {
      node: AXNode;
    };
    /**
     * Fetches a node and all ancestors up to and including the root.
     * Requires `enable()` to have been called previously.
     * @request `Accessibility.getAXNodeAndAncestors`
     */
    export type GetAXNodeAndAncestorsRequest = {
      /**
       * Identifier of the node to get.
       */
      nodeId?: DOM.NodeId | undefined;
      /**
       * Identifier of the backend node to get.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper to get.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
    };
    /**
     * Fetches a node and all ancestors up to and including the root.
     * Requires `enable()` to have been called previously.
     * @response `Accessibility.getAXNodeAndAncestors`
     */
    export type GetAXNodeAndAncestorsResponse = {
      nodes: AXNode[];
    };
    /**
     * Fetches a particular accessibility node by AXNodeId.
     * Requires `enable()` to have been called previously.
     * @request `Accessibility.getChildAXNodes`
     */
    export type GetChildAXNodesRequest = {
      id: AXNodeId;
      /**
       * The frame in whose document the node resides.
       * If omitted, the root frame is used.
       */
      frameId?: Page.FrameId | undefined;
    };
    /**
     * Fetches a particular accessibility node by AXNodeId.
     * Requires `enable()` to have been called previously.
     * @response `Accessibility.getChildAXNodes`
     */
    export type GetChildAXNodesResponse = {
      nodes: AXNode[];
    };
    /**
     * Query a DOM node's accessibility subtree for accessible name and role.
     * This command computes the name and role for all nodes in the subtree, including those that are
     * ignored for accessibility, and returns those that mactch the specified name and role. If no DOM
     * node is specified, or the DOM node does not exist, the command returns an error. If neither
     * `accessibleName` or `role` is specified, it returns all the accessibility nodes in the subtree.
     * @request `Accessibility.queryAXTree`
     */
    export type QueryAXTreeRequest = {
      /**
       * Identifier of the node for the root to query.
       */
      nodeId?: DOM.NodeId | undefined;
      /**
       * Identifier of the backend node for the root to query.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper for the root to query.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
      /**
       * Find nodes with this computed name.
       */
      accessibleName?: string | undefined;
      /**
       * Find nodes with this computed role.
       */
      role?: string | undefined;
    };
    /**
     * Query a DOM node's accessibility subtree for accessible name and role.
     * This command computes the name and role for all nodes in the subtree, including those that are
     * ignored for accessibility, and returns those that mactch the specified name and role. If no DOM
     * node is specified, or the DOM node does not exist, the command returns an error. If neither
     * `accessibleName` or `role` is specified, it returns all the accessibility nodes in the subtree.
     * @response `Accessibility.queryAXTree`
     */
    export type QueryAXTreeResponse = {
      /**
       * A list of `Accessibility.AXNode` matching the specified attributes,
       * including nodes that are ignored for accessibility.
       */
      nodes: AXNode[];
    };
  }
  export namespace Animation {
    /**
     * Animation instance.
     */
    export type Animation = {
      /**
       * `Animation`'s id.
       */
      id: string;
      /**
       * `Animation`'s name.
       */
      name: string;
      /**
       * `Animation`'s internal paused state.
       */
      pausedState: boolean;
      /**
       * `Animation`'s play state.
       */
      playState: string;
      /**
       * `Animation`'s playback rate.
       */
      playbackRate: number;
      /**
       * `Animation`'s start time.
       */
      startTime: number;
      /**
       * `Animation`'s current time.
       */
      currentTime: number;
      /**
       * Animation type of `Animation`.
       */
      type: "CSSTransition" | "CSSAnimation" | "WebAnimation";
      /**
       * `Animation`'s source animation node.
       */
      source?: AnimationEffect | undefined;
      /**
       * A unique ID for `Animation` representing the sources that triggered this CSS
       * animation/transition.
       */
      cssId?: string | undefined;
    };
    /**
     * AnimationEffect instance
     */
    export type AnimationEffect = {
      /**
       * `AnimationEffect`'s delay.
       */
      delay: number;
      /**
       * `AnimationEffect`'s end delay.
       */
      endDelay: number;
      /**
       * `AnimationEffect`'s iteration start.
       */
      iterationStart: number;
      /**
       * `AnimationEffect`'s iterations.
       */
      iterations: number;
      /**
       * `AnimationEffect`'s iteration duration.
       */
      duration: number;
      /**
       * `AnimationEffect`'s playback direction.
       */
      direction: string;
      /**
       * `AnimationEffect`'s fill mode.
       */
      fill: string;
      /**
       * `AnimationEffect`'s target node.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * `AnimationEffect`'s keyframes.
       */
      keyframesRule?: KeyframesRule | undefined;
      /**
       * `AnimationEffect`'s timing function.
       */
      easing: string;
    };
    /**
     * Keyframes Rule
     */
    export type KeyframesRule = {
      /**
       * CSS keyframed animation's name.
       */
      name?: string | undefined;
      /**
       * List of animation keyframes.
       */
      keyframes: KeyframeStyle[];
    };
    /**
     * Keyframe Style
     */
    export type KeyframeStyle = {
      /**
       * Keyframe's time offset.
       */
      offset: string;
      /**
       * `AnimationEffect`'s timing function.
       */
      easing: string;
    };
    /**
     * Event for when an animation has been cancelled.
     * @event `Animation.animationCanceled`
     */
    export type AnimationCanceledEvent = {
      /**
       * Id of the animation that was cancelled.
       */
      id: string;
    };
    /**
     * Event for each animation that has been created.
     * @event `Animation.animationCreated`
     */
    export type AnimationCreatedEvent = {
      /**
       * Id of the animation that was created.
       */
      id: string;
    };
    /**
     * Event for animation that has been started.
     * @event `Animation.animationStarted`
     */
    export type AnimationStartedEvent = {
      /**
       * Animation that was started.
       */
      animation: Animation;
    };
    /**
     * Disables animation domain notifications.
     * @request `Animation.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables animation domain notifications.
     * @response `Animation.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables animation domain notifications.
     * @request `Animation.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables animation domain notifications.
     * @response `Animation.enable`
     */
    export type EnableResponse = {};
    /**
     * Returns the current time of the an animation.
     * @request `Animation.getCurrentTime`
     */
    export type GetCurrentTimeRequest = {
      /**
       * Id of animation.
       */
      id: string;
    };
    /**
     * Returns the current time of the an animation.
     * @response `Animation.getCurrentTime`
     */
    export type GetCurrentTimeResponse = {
      /**
       * Current time of the page.
       */
      currentTime: number;
    };
    /**
     * Gets the playback rate of the document timeline.
     * @request `Animation.getPlaybackRate`
     */
    export type GetPlaybackRateRequest = {};
    /**
     * Gets the playback rate of the document timeline.
     * @response `Animation.getPlaybackRate`
     */
    export type GetPlaybackRateResponse = {
      /**
       * Playback rate for animations on page.
       */
      playbackRate: number;
    };
    /**
     * Releases a set of animations to no longer be manipulated.
     * @request `Animation.releaseAnimations`
     */
    export type ReleaseAnimationsRequest = {
      /**
       * List of animation ids to seek.
       */
      animations: string[];
    };
    /**
     * Releases a set of animations to no longer be manipulated.
     * @response `Animation.releaseAnimations`
     */
    export type ReleaseAnimationsResponse = {};
    /**
     * Gets the remote object of the Animation.
     * @request `Animation.resolveAnimation`
     */
    export type ResolveAnimationRequest = {
      /**
       * Animation id.
       */
      animationId: string;
    };
    /**
     * Gets the remote object of the Animation.
     * @response `Animation.resolveAnimation`
     */
    export type ResolveAnimationResponse = {
      /**
       * Corresponding remote object.
       */
      remoteObject: Runtime.RemoteObject;
    };
    /**
     * Seek a set of animations to a particular time within each animation.
     * @request `Animation.seekAnimations`
     */
    export type SeekAnimationsRequest = {
      /**
       * List of animation ids to seek.
       */
      animations: string[];
      /**
       * Set the current time of each animation.
       */
      currentTime: number;
    };
    /**
     * Seek a set of animations to a particular time within each animation.
     * @response `Animation.seekAnimations`
     */
    export type SeekAnimationsResponse = {};
    /**
     * Sets the paused state of a set of animations.
     * @request `Animation.setPaused`
     */
    export type SetPausedRequest = {
      /**
       * Animations to set the pause state of.
       */
      animations: string[];
      /**
       * Paused state to set to.
       */
      paused: boolean;
    };
    /**
     * Sets the paused state of a set of animations.
     * @response `Animation.setPaused`
     */
    export type SetPausedResponse = {};
    /**
     * Sets the playback rate of the document timeline.
     * @request `Animation.setPlaybackRate`
     */
    export type SetPlaybackRateRequest = {
      /**
       * Playback rate for animations on page
       */
      playbackRate: number;
    };
    /**
     * Sets the playback rate of the document timeline.
     * @response `Animation.setPlaybackRate`
     */
    export type SetPlaybackRateResponse = {};
    /**
     * Sets the timing of an animation node.
     * @request `Animation.setTiming`
     */
    export type SetTimingRequest = {
      /**
       * Animation id.
       */
      animationId: string;
      /**
       * Duration of the animation.
       */
      duration: number;
      /**
       * Delay of the animation.
       */
      delay: number;
    };
    /**
     * Sets the timing of an animation node.
     * @response `Animation.setTiming`
     */
    export type SetTimingResponse = {};
  }
  export namespace Audits {
    /**
     * Information about a cookie that is affected by an inspector issue.
     */
    export type AffectedCookie = {
      /**
       * The following three properties uniquely identify a cookie
       */
      name: string;
      path: string;
      domain: string;
    };
    /**
     * Information about a request that is affected by an inspector issue.
     */
    export type AffectedRequest = {
      /**
       * The unique request id.
       */
      requestId: Network.RequestId;
      url?: string | undefined;
    };
    /**
     * Information about the frame affected by an inspector issue.
     */
    export type AffectedFrame = {
      frameId: Page.FrameId;
    };
    export type CookieExclusionReason =
      | "ExcludeSameSiteUnspecifiedTreatedAsLax"
      | "ExcludeSameSiteNoneInsecure"
      | "ExcludeSameSiteLax"
      | "ExcludeSameSiteStrict"
      | "ExcludeInvalidSameParty"
      | "ExcludeSamePartyCrossPartyContext"
      | "ExcludeDomainNonASCII"
      | "ExcludeThirdPartyCookieBlockedInFirstPartySet"
      | "ExcludeThirdPartyPhaseout";
    export type CookieWarningReason =
      | "WarnSameSiteUnspecifiedCrossSiteContext"
      | "WarnSameSiteNoneInsecure"
      | "WarnSameSiteUnspecifiedLaxAllowUnsafe"
      | "WarnSameSiteStrictLaxDowngradeStrict"
      | "WarnSameSiteStrictCrossDowngradeStrict"
      | "WarnSameSiteStrictCrossDowngradeLax"
      | "WarnSameSiteLaxCrossDowngradeStrict"
      | "WarnSameSiteLaxCrossDowngradeLax"
      | "WarnAttributeValueExceedsMaxSize"
      | "WarnDomainNonASCII"
      | "WarnThirdPartyPhaseout"
      | "WarnCrossSiteRedirectDowngradeChangesInclusion";
    export type CookieOperation = "SetCookie" | "ReadCookie";
    /**
     * This information is currently necessary, as the front-end has a difficult
     * time finding a specific cookie. With this, we can convey specific error
     * information without the cookie.
     */
    export type CookieIssueDetails = {
      /**
       * If AffectedCookie is not set then rawCookieLine contains the raw
       * Set-Cookie header string. This hints at a problem where the
       * cookie line is syntactically or semantically malformed in a way
       * that no valid cookie could be created.
       */
      cookie?: AffectedCookie | undefined;
      rawCookieLine?: string | undefined;
      cookieWarningReasons: CookieWarningReason[];
      cookieExclusionReasons: CookieExclusionReason[];
      /**
       * Optionally identifies the site-for-cookies and the cookie url, which
       * may be used by the front-end as additional context.
       */
      operation: CookieOperation;
      siteForCookies?: string | undefined;
      cookieUrl?: string | undefined;
      request?: AffectedRequest | undefined;
    };
    export type MixedContentResolutionStatus =
      | "MixedContentBlocked"
      | "MixedContentAutomaticallyUpgraded"
      | "MixedContentWarning";
    export type MixedContentResourceType =
      | "AttributionSrc"
      | "Audio"
      | "Beacon"
      | "CSPReport"
      | "Download"
      | "EventSource"
      | "Favicon"
      | "Font"
      | "Form"
      | "Frame"
      | "Image"
      | "Import"
      | "Manifest"
      | "Ping"
      | "PluginData"
      | "PluginResource"
      | "Prefetch"
      | "Resource"
      | "Script"
      | "ServiceWorker"
      | "SharedWorker"
      | "SpeculationRules"
      | "Stylesheet"
      | "Track"
      | "Video"
      | "Worker"
      | "XMLHttpRequest"
      | "XSLT";
    export type MixedContentIssueDetails = {
      /**
       * The type of resource causing the mixed content issue (css, js, iframe,
       * form,...). Marked as optional because it is mapped to from
       * blink::mojom::RequestContextType, which will be replaced
       * by network::mojom::RequestDestination
       */
      resourceType?: MixedContentResourceType | undefined;
      /**
       * The way the mixed content issue is being resolved.
       */
      resolutionStatus: MixedContentResolutionStatus;
      /**
       * The unsafe http url causing the mixed content issue.
       */
      insecureURL: string;
      /**
       * The url responsible for the call to an unsafe url.
       */
      mainResourceURL: string;
      /**
       * The mixed content request.
       * Does not always exist (e.g. for unsafe form submission urls).
       */
      request?: AffectedRequest | undefined;
      /**
       * Optional because not every mixed content issue is necessarily linked to a frame.
       */
      frame?: AffectedFrame | undefined;
    };
    /**
     * Enum indicating the reason a response has been blocked. These reasons are
     * refinements of the net error BLOCKED_BY_RESPONSE.
     */
    export type BlockedByResponseReason =
      | "CoepFrameResourceNeedsCoepHeader"
      | "CoopSandboxedIFrameCannotNavigateToCoopPage"
      | "CorpNotSameOrigin"
      | "CorpNotSameOriginAfterDefaultedToSameOriginByCoep"
      | "CorpNotSameSite";
    /**
     * Details for a request that has been blocked with the BLOCKED_BY_RESPONSE
     * code. Currently only used for COEP/COOP, but may be extended to include
     * some CSP errors in the future.
     */
    export type BlockedByResponseIssueDetails = {
      request: AffectedRequest;
      parentFrame?: AffectedFrame | undefined;
      blockedFrame?: AffectedFrame | undefined;
      reason: BlockedByResponseReason;
    };
    export type HeavyAdResolutionStatus = "HeavyAdBlocked" | "HeavyAdWarning";
    export type HeavyAdReason = "NetworkTotalLimit" | "CpuTotalLimit" | "CpuPeakLimit";
    export type HeavyAdIssueDetails = {
      /**
       * The resolution status, either blocking the content or warning.
       */
      resolution: HeavyAdResolutionStatus;
      /**
       * The reason the ad was blocked, total network or cpu or peak cpu.
       */
      reason: HeavyAdReason;
      /**
       * The frame that was blocked.
       */
      frame: AffectedFrame;
    };
    export type ContentSecurityPolicyViolationType =
      | "kInlineViolation"
      | "kEvalViolation"
      | "kURLViolation"
      | "kTrustedTypesSinkViolation"
      | "kTrustedTypesPolicyViolation"
      | "kWasmEvalViolation";
    export type SourceCodeLocation = {
      scriptId?: Runtime.ScriptId | undefined;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    export type ContentSecurityPolicyIssueDetails = {
      /**
       * The url not included in allowed sources.
       */
      blockedURL?: string | undefined;
      /**
       * Specific directive that is violated, causing the CSP issue.
       */
      violatedDirective: string;
      isReportOnly: boolean;
      contentSecurityPolicyViolationType: ContentSecurityPolicyViolationType;
      frameAncestor?: AffectedFrame | undefined;
      sourceCodeLocation?: SourceCodeLocation | undefined;
      violatingNodeId?: DOM.BackendNodeId | undefined;
    };
    export type SharedArrayBufferIssueType = "TransferIssue" | "CreationIssue";
    /**
     * Details for a issue arising from an SAB being instantiated in, or
     * transferred to a context that is not cross-origin isolated.
     */
    export type SharedArrayBufferIssueDetails = {
      sourceCodeLocation: SourceCodeLocation;
      isWarning: boolean;
      type: SharedArrayBufferIssueType;
    };
    export type LowTextContrastIssueDetails = {
      violatingNodeId: DOM.BackendNodeId;
      violatingNodeSelector: string;
      contrastRatio: number;
      thresholdAA: number;
      thresholdAAA: number;
      fontSize: string;
      fontWeight: string;
    };
    /**
     * Details for a CORS related issue, e.g. a warning or error related to
     * CORS RFC1918 enforcement.
     */
    export type CorsIssueDetails = {
      corsErrorStatus: Network.CorsErrorStatus;
      isWarning: boolean;
      request: AffectedRequest;
      location?: SourceCodeLocation | undefined;
      initiatorOrigin?: string | undefined;
      resourceIPAddressSpace?: Network.IPAddressSpace | undefined;
      clientSecurityState?: Network.ClientSecurityState | undefined;
    };
    export type AttributionReportingIssueType =
      | "PermissionPolicyDisabled"
      | "UntrustworthyReportingOrigin"
      | "InsecureContext"
      | "InvalidHeader"
      | "InvalidRegisterTriggerHeader"
      | "SourceAndTriggerHeaders"
      | "SourceIgnored"
      | "TriggerIgnored"
      | "OsSourceIgnored"
      | "OsTriggerIgnored"
      | "InvalidRegisterOsSourceHeader"
      | "InvalidRegisterOsTriggerHeader"
      | "WebAndOsHeaders"
      | "NoWebOrOsSupport"
      | "NavigationRegistrationWithoutTransientUserActivation";
    /**
     * Details for issues around "Attribution Reporting API" usage.
     * Explainer: https://github.com/WICG/attribution-reporting-api
     */
    export type AttributionReportingIssueDetails = {
      violationType: AttributionReportingIssueType;
      request?: AffectedRequest | undefined;
      violatingNodeId?: DOM.BackendNodeId | undefined;
      invalidParameter?: string | undefined;
    };
    /**
     * Details for issues about documents in Quirks Mode
     * or Limited Quirks Mode that affects page layouting.
     */
    export type QuirksModeIssueDetails = {
      /**
       * If false, it means the document's mode is "quirks"
       * instead of "limited-quirks".
       */
      isLimitedQuirksMode: boolean;
      documentNodeId: DOM.BackendNodeId;
      url: string;
      frameId: Page.FrameId;
      loaderId: Network.LoaderId;
    };
    export type NavigatorUserAgentIssueDetails = {
      url: string;
      location?: SourceCodeLocation | undefined;
    };
    export type GenericIssueErrorType =
      | "CrossOriginPortalPostMessageError"
      | "FormLabelForNameError"
      | "FormDuplicateIdForInputError"
      | "FormInputWithNoLabelError"
      | "FormAutocompleteAttributeEmptyError"
      | "FormEmptyIdAndNameAttributesForInputError"
      | "FormAriaLabelledByToNonExistingId"
      | "FormInputAssignedAutocompleteValueToIdOrNameAttributeError"
      | "FormLabelHasNeitherForNorNestedInput"
      | "FormLabelForMatchesNonExistingIdError"
      | "FormInputHasWrongButWellIntendedAutocompleteValueError"
      | "ResponseWasBlockedByORB";
    /**
     * Depending on the concrete errorType, different properties are set.
     */
    export type GenericIssueDetails = {
      /**
       * Issues with the same errorType are aggregated in the frontend.
       */
      errorType: GenericIssueErrorType;
      frameId?: Page.FrameId | undefined;
      violatingNodeId?: DOM.BackendNodeId | undefined;
      violatingNodeAttribute?: string | undefined;
      request?: AffectedRequest | undefined;
    };
    /**
     * This issue tracks information needed to print a deprecation message.
     * https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/frame/third_party/blink/renderer/core/frame/deprecation/README.md
     */
    export type DeprecationIssueDetails = {
      affectedFrame?: AffectedFrame | undefined;
      sourceCodeLocation: SourceCodeLocation;
      /**
       * One of the deprecation names from third_party/blink/renderer/core/frame/deprecation/deprecation.json5
       */
      type: string;
    };
    /**
     * This issue warns about sites in the redirect chain of a finished navigation
     * that may be flagged as trackers and have their state cleared if they don't
     * receive a user interaction. Note that in this context 'site' means eTLD+1.
     * For example, if the URL `https://example.test:80/bounce` was in the
     * redirect chain, the site reported would be `example.test`.
     */
    export type BounceTrackingIssueDetails = {
      trackingSites: string[];
    };
    /**
     * This issue warns about third-party sites that are accessing cookies on the
     * current page, and have been permitted due to having a global metadata grant.
     * Note that in this context 'site' means eTLD+1. For example, if the URL
     * `https://example.test:80/web_page` was accessing cookies, the site reported
     * would be `example.test`.
     */
    export type CookieDeprecationMetadataIssueDetails = {
      allowedSites: string[];
    };
    export type ClientHintIssueReason = "MetaTagAllowListInvalidOrigin" | "MetaTagModifiedHTML";
    export type FederatedAuthRequestIssueDetails = {
      federatedAuthRequestIssueReason: FederatedAuthRequestIssueReason;
    };
    /**
     * Represents the failure reason when a federated authentication reason fails.
     * Should be updated alongside RequestIdTokenStatus in
     * third_party/blink/public/mojom/devtools/inspector_issue.mojom to include
     * all cases except for success.
     */
    export type FederatedAuthRequestIssueReason =
      | "ShouldEmbargo"
      | "TooManyRequests"
      | "WellKnownHttpNotFound"
      | "WellKnownNoResponse"
      | "WellKnownInvalidResponse"
      | "WellKnownListEmpty"
      | "WellKnownInvalidContentType"
      | "ConfigNotInWellKnown"
      | "WellKnownTooBig"
      | "ConfigHttpNotFound"
      | "ConfigNoResponse"
      | "ConfigInvalidResponse"
      | "ConfigInvalidContentType"
      | "ClientMetadataHttpNotFound"
      | "ClientMetadataNoResponse"
      | "ClientMetadataInvalidResponse"
      | "ClientMetadataInvalidContentType"
      | "DisabledInSettings"
      | "ErrorFetchingSignin"
      | "InvalidSigninResponse"
      | "AccountsHttpNotFound"
      | "AccountsNoResponse"
      | "AccountsInvalidResponse"
      | "AccountsListEmpty"
      | "AccountsInvalidContentType"
      | "IdTokenHttpNotFound"
      | "IdTokenNoResponse"
      | "IdTokenInvalidResponse"
      | "IdTokenIdpErrorResponse"
      | "IdTokenCrossSiteIdpErrorResponse"
      | "IdTokenInvalidRequest"
      | "IdTokenInvalidContentType"
      | "ErrorIdToken"
      | "Canceled"
      | "RpPageNotVisible"
      | "SilentMediationFailure"
      | "ThirdPartyCookiesBlocked"
      | "NotSignedInWithIdp";
    export type FederatedAuthUserInfoRequestIssueDetails = {
      federatedAuthUserInfoRequestIssueReason: FederatedAuthUserInfoRequestIssueReason;
    };
    /**
     * Represents the failure reason when a getUserInfo() call fails.
     * Should be updated alongside FederatedAuthUserInfoRequestResult in
     * third_party/blink/public/mojom/devtools/inspector_issue.mojom.
     */
    export type FederatedAuthUserInfoRequestIssueReason =
      | "NotSameOrigin"
      | "NotIframe"
      | "NotPotentiallyTrustworthy"
      | "NoApiPermission"
      | "NotSignedInWithIdp"
      | "NoAccountSharingPermission"
      | "InvalidConfigOrWellKnown"
      | "InvalidAccountsResponse"
      | "NoReturningUserFromFetchedAccounts";
    /**
     * This issue tracks client hints related issues. It's used to deprecate old
     * features, encourage the use of new ones, and provide general guidance.
     */
    export type ClientHintIssueDetails = {
      sourceCodeLocation: SourceCodeLocation;
      clientHintIssueReason: ClientHintIssueReason;
    };
    export type FailedRequestInfo = {
      /**
       * The URL that failed to load.
       */
      url: string;
      /**
       * The failure message for the failed request.
       */
      failureMessage: string;
      requestId?: Network.RequestId | undefined;
    };
    export type StyleSheetLoadingIssueReason = "LateImportRule" | "RequestFailed";
    /**
     * This issue warns when a referenced stylesheet couldn't be loaded.
     */
    export type StylesheetLoadingIssueDetails = {
      /**
       * Source code position that referenced the failing stylesheet.
       */
      sourceCodeLocation: SourceCodeLocation;
      /**
       * Reason why the stylesheet couldn't be loaded.
       */
      styleSheetLoadingIssueReason: StyleSheetLoadingIssueReason;
      /**
       * Contains additional info when the failure was due to a request.
       */
      failedRequestInfo?: FailedRequestInfo | undefined;
    };
    export type PropertyRuleIssueReason = "InvalidSyntax" | "InvalidInitialValue" | "InvalidInherits" | "InvalidName";
    /**
     * This issue warns about errors in property rules that lead to property
     * registrations being ignored.
     */
    export type PropertyRuleIssueDetails = {
      /**
       * Source code position of the property rule.
       */
      sourceCodeLocation: SourceCodeLocation;
      /**
       * Reason why the property rule was discarded.
       */
      propertyRuleIssueReason: PropertyRuleIssueReason;
      /**
       * The value of the property rule property that failed to parse
       */
      propertyValue?: string | undefined;
    };
    /**
     * A unique identifier for the type of issue. Each type may use one of the
     * optional fields in InspectorIssueDetails to convey more specific
     * information about the kind of issue.
     */
    export type InspectorIssueCode =
      | "CookieIssue"
      | "MixedContentIssue"
      | "BlockedByResponseIssue"
      | "HeavyAdIssue"
      | "ContentSecurityPolicyIssue"
      | "SharedArrayBufferIssue"
      | "LowTextContrastIssue"
      | "CorsIssue"
      | "AttributionReportingIssue"
      | "QuirksModeIssue"
      | "NavigatorUserAgentIssue"
      | "GenericIssue"
      | "DeprecationIssue"
      | "ClientHintIssue"
      | "FederatedAuthRequestIssue"
      | "BounceTrackingIssue"
      | "CookieDeprecationMetadataIssue"
      | "StylesheetLoadingIssue"
      | "FederatedAuthUserInfoRequestIssue"
      | "PropertyRuleIssue";
    /**
     * This struct holds a list of optional fields with additional information
     * specific to the kind of issue. When adding a new issue code, please also
     * add a new optional field to this type.
     */
    export type InspectorIssueDetails = {
      cookieIssueDetails?: CookieIssueDetails | undefined;
      mixedContentIssueDetails?: MixedContentIssueDetails | undefined;
      blockedByResponseIssueDetails?: BlockedByResponseIssueDetails | undefined;
      heavyAdIssueDetails?: HeavyAdIssueDetails | undefined;
      contentSecurityPolicyIssueDetails?: ContentSecurityPolicyIssueDetails | undefined;
      sharedArrayBufferIssueDetails?: SharedArrayBufferIssueDetails | undefined;
      lowTextContrastIssueDetails?: LowTextContrastIssueDetails | undefined;
      corsIssueDetails?: CorsIssueDetails | undefined;
      attributionReportingIssueDetails?: AttributionReportingIssueDetails | undefined;
      quirksModeIssueDetails?: QuirksModeIssueDetails | undefined;
      navigatorUserAgentIssueDetails?: NavigatorUserAgentIssueDetails | undefined;
      genericIssueDetails?: GenericIssueDetails | undefined;
      deprecationIssueDetails?: DeprecationIssueDetails | undefined;
      clientHintIssueDetails?: ClientHintIssueDetails | undefined;
      federatedAuthRequestIssueDetails?: FederatedAuthRequestIssueDetails | undefined;
      bounceTrackingIssueDetails?: BounceTrackingIssueDetails | undefined;
      cookieDeprecationMetadataIssueDetails?: CookieDeprecationMetadataIssueDetails | undefined;
      stylesheetLoadingIssueDetails?: StylesheetLoadingIssueDetails | undefined;
      propertyRuleIssueDetails?: PropertyRuleIssueDetails | undefined;
      federatedAuthUserInfoRequestIssueDetails?: FederatedAuthUserInfoRequestIssueDetails | undefined;
    };
    /**
     * A unique id for a DevTools inspector issue. Allows other entities (e.g.
     * exceptions, CDP message, console messages, etc.) to reference an issue.
     */
    export type IssueId = string;
    /**
     * An inspector issue reported from the back-end.
     */
    export type InspectorIssue = {
      code: InspectorIssueCode;
      details: InspectorIssueDetails;
      /**
       * A unique id for this issue. May be omitted if no other entity (e.g.
       * exception, CDP message, etc.) is referencing this issue.
       */
      issueId?: IssueId | undefined;
    };
    /**
     * undefined
     * @event `Audits.issueAdded`
     */
    export type IssueAddedEvent = {
      issue: InspectorIssue;
    };
    /**
     * Returns the response body and size if it were re-encoded with the specified settings. Only
     * applies to images.
     * @request `Audits.getEncodedResponse`
     */
    export type GetEncodedResponseRequest = {
      /**
       * Identifier of the network request to get content for.
       */
      requestId: Network.RequestId;
      /**
       * The encoding to use.
       */
      encoding: "webp" | "jpeg" | "png";
      /**
       * The quality of the encoding (0-1). (defaults to 1)
       */
      quality?: number | undefined;
      /**
       * Whether to only return the size information (defaults to false).
       */
      sizeOnly?: boolean | undefined;
    };
    /**
     * Returns the response body and size if it were re-encoded with the specified settings. Only
     * applies to images.
     * @response `Audits.getEncodedResponse`
     */
    export type GetEncodedResponseResponse = {
      /**
       * The encoded body as a base64 string. Omitted if sizeOnly is true. (Encoded as a base64 string when passed over JSON)
       */
      body?: string | undefined;
      /**
       * Size before re-encoding.
       */
      originalSize: number;
      /**
       * Size after re-encoding.
       */
      encodedSize: number;
    };
    /**
     * Disables issues domain, prevents further issues from being reported to the client.
     * @request `Audits.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables issues domain, prevents further issues from being reported to the client.
     * @response `Audits.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables issues domain, sends the issues collected so far to the client by means of the
     * `issueAdded` event.
     * @request `Audits.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables issues domain, sends the issues collected so far to the client by means of the
     * `issueAdded` event.
     * @response `Audits.enable`
     */
    export type EnableResponse = {};
    /**
     * Runs the contrast check for the target page. Found issues are reported
     * using Audits.issueAdded event.
     * @request `Audits.checkContrast`
     */
    export type CheckContrastRequest = {
      /**
       * Whether to report WCAG AAA level issues. Default is false.
       */
      reportAAA?: boolean | undefined;
    };
    /**
     * Runs the contrast check for the target page. Found issues are reported
     * using Audits.issueAdded event.
     * @response `Audits.checkContrast`
     */
    export type CheckContrastResponse = {};
    /**
     * Runs the form issues check for the target page. Found issues are reported
     * using Audits.issueAdded event.
     * @request `Audits.checkFormsIssues`
     */
    export type CheckFormsIssuesRequest = {};
    /**
     * Runs the form issues check for the target page. Found issues are reported
     * using Audits.issueAdded event.
     * @response `Audits.checkFormsIssues`
     */
    export type CheckFormsIssuesResponse = {
      formIssues: GenericIssueDetails[];
    };
  }
  export namespace Autofill {
    export type CreditCard = {
      /**
       * 16-digit credit card number.
       */
      number: string;
      /**
       * Name of the credit card owner.
       */
      name: string;
      /**
       * 2-digit expiry month.
       */
      expiryMonth: string;
      /**
       * 4-digit expiry year.
       */
      expiryYear: string;
      /**
       * 3-digit card verification code.
       */
      cvc: string;
    };
    export type AddressField = {
      /**
       * address field name, for example GIVEN_NAME.
       */
      name: string;
      /**
       * address field value, for example Jon Doe.
       */
      value: string;
    };
    /**
     * A list of address fields.
     */
    export type AddressFields = {
      fields: AddressField[];
    };
    export type Address = {
      /**
       * fields and values defining an address.
       */
      fields: AddressField[];
    };
    /**
     * Defines how an address can be displayed like in chrome://settings/addresses.
     * Address UI is a two dimensional array, each inner array is an "address information line", and when rendered in a UI surface should be displayed as such.
     * The following address UI for instance:
     * [[{name: "GIVE_NAME", value: "Jon"}, {name: "FAMILY_NAME", value: "Doe"}], [{name: "CITY", value: "Munich"}, {name: "ZIP", value: "81456"}]]
     * should allow the receiver to render:
     * Jon Doe
     * Munich 81456
     */
    export type AddressUI = {
      /**
       * A two dimension array containing the repesentation of values from an address profile.
       */
      addressFields: AddressFields[];
    };
    /**
     * Specified whether a filled field was done so by using the html autocomplete attribute or autofill heuristics.
     */
    export type FillingStrategy = "autocompleteAttribute" | "autofillInferred";
    export type FilledField = {
      /**
       * The type of the field, e.g text, password etc.
       */
      htmlType: string;
      /**
       * the html id
       */
      id: string;
      /**
       * the html name
       */
      name: string;
      /**
       * the field value
       */
      value: string;
      /**
       * The actual field type, e.g FAMILY_NAME
       */
      autofillType: string;
      /**
       * The filling strategy
       */
      fillingStrategy: FillingStrategy;
      /**
       * The form field's DOM node
       */
      fieldId: DOM.BackendNodeId;
    };
    /**
     * Emitted when an address form is filled.
     * @event `Autofill.addressFormFilled`
     */
    export type AddressFormFilledEvent = {
      /**
       * Information about the fields that were filled
       */
      filledFields: FilledField[];
      /**
       * An UI representation of the address used to fill the form.
       * Consists of a 2D array where each child represents an address/profile line.
       */
      addressUi: AddressUI;
    };
    /**
     * Trigger autofill on a form identified by the fieldId.
     * If the field and related form cannot be autofilled, returns an error.
     * @request `Autofill.trigger`
     */
    export type TriggerRequest = {
      /**
       * Identifies a field that serves as an anchor for autofill.
       */
      fieldId: DOM.BackendNodeId;
      /**
       * Identifies the frame that field belongs to.
       */
      frameId?: Page.FrameId | undefined;
      /**
       * Credit card information to fill out the form. Credit card data is not saved.
       */
      card: CreditCard;
    };
    /**
     * Trigger autofill on a form identified by the fieldId.
     * If the field and related form cannot be autofilled, returns an error.
     * @response `Autofill.trigger`
     */
    export type TriggerResponse = {};
    /**
     * Set addresses so that developers can verify their forms implementation.
     * @request `Autofill.setAddresses`
     */
    export type SetAddressesRequest = {
      addresses: Address[];
    };
    /**
     * Set addresses so that developers can verify their forms implementation.
     * @response `Autofill.setAddresses`
     */
    export type SetAddressesResponse = {};
    /**
     * Disables autofill domain notifications.
     * @request `Autofill.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables autofill domain notifications.
     * @response `Autofill.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables autofill domain notifications.
     * @request `Autofill.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables autofill domain notifications.
     * @response `Autofill.enable`
     */
    export type EnableResponse = {};
  }
  export namespace BackgroundService {
    /**
     * The Background Service that will be associated with the commands/events.
     * Every Background Service operates independently, but they share the same
     * API.
     */
    export type ServiceName =
      | "backgroundFetch"
      | "backgroundSync"
      | "pushMessaging"
      | "notifications"
      | "paymentHandler"
      | "periodicBackgroundSync";
    /**
     * A key-value pair for additional event information to pass along.
     */
    export type EventMetadata = {
      key: string;
      value: string;
    };
    export type BackgroundServiceEvent = {
      /**
       * Timestamp of the event (in seconds).
       */
      timestamp: Network.TimeSinceEpoch;
      /**
       * The origin this event belongs to.
       */
      origin: string;
      /**
       * The Service Worker ID that initiated the event.
       */
      serviceWorkerRegistrationId: ServiceWorker.RegistrationID;
      /**
       * The Background Service this event belongs to.
       */
      service: ServiceName;
      /**
       * A description of the event.
       */
      eventName: string;
      /**
       * An identifier that groups related events together.
       */
      instanceId: string;
      /**
       * A list of event-specific information.
       */
      eventMetadata: EventMetadata[];
      /**
       * Storage key this event belongs to.
       */
      storageKey: string;
    };
    /**
     * Called when the recording state for the service has been updated.
     * @event `BackgroundService.recordingStateChanged`
     */
    export type RecordingStateChangedEvent = {
      isRecording: boolean;
      service: ServiceName;
    };
    /**
     * Called with all existing backgroundServiceEvents when enabled, and all new
     * events afterwards if enabled and recording.
     * @event `BackgroundService.backgroundServiceEventReceived`
     */
    export type BackgroundServiceEventReceivedEvent = {
      backgroundServiceEvent: BackgroundServiceEvent;
    };
    /**
     * Enables event updates for the service.
     * @request `BackgroundService.startObserving`
     */
    export type StartObservingRequest = {
      service: ServiceName;
    };
    /**
     * Enables event updates for the service.
     * @response `BackgroundService.startObserving`
     */
    export type StartObservingResponse = {};
    /**
     * Disables event updates for the service.
     * @request `BackgroundService.stopObserving`
     */
    export type StopObservingRequest = {
      service: ServiceName;
    };
    /**
     * Disables event updates for the service.
     * @response `BackgroundService.stopObserving`
     */
    export type StopObservingResponse = {};
    /**
     * Set the recording state for the service.
     * @request `BackgroundService.setRecording`
     */
    export type SetRecordingRequest = {
      shouldRecord: boolean;
      service: ServiceName;
    };
    /**
     * Set the recording state for the service.
     * @response `BackgroundService.setRecording`
     */
    export type SetRecordingResponse = {};
    /**
     * Clears all stored data for the service.
     * @request `BackgroundService.clearEvents`
     */
    export type ClearEventsRequest = {
      service: ServiceName;
    };
    /**
     * Clears all stored data for the service.
     * @response `BackgroundService.clearEvents`
     */
    export type ClearEventsResponse = {};
  }
  export namespace Browser {
    export type BrowserContextID = string;
    export type WindowID = number;
    /**
     * The state of the browser window.
     */
    export type WindowState = "normal" | "minimized" | "maximized" | "fullscreen";
    /**
     * Browser window bounds information
     */
    export type Bounds = {
      /**
       * The offset from the left edge of the screen to the window in pixels.
       */
      left?: number | undefined;
      /**
       * The offset from the top edge of the screen to the window in pixels.
       */
      top?: number | undefined;
      /**
       * The window width in pixels.
       */
      width?: number | undefined;
      /**
       * The window height in pixels.
       */
      height?: number | undefined;
      /**
       * The window state. Default to normal.
       */
      windowState?: WindowState | undefined;
    };
    export type PermissionType =
      | "accessibilityEvents"
      | "audioCapture"
      | "backgroundSync"
      | "backgroundFetch"
      | "capturedSurfaceControl"
      | "clipboardReadWrite"
      | "clipboardSanitizedWrite"
      | "displayCapture"
      | "durableStorage"
      | "flash"
      | "geolocation"
      | "idleDetection"
      | "localFonts"
      | "midi"
      | "midiSysex"
      | "nfc"
      | "notifications"
      | "paymentHandler"
      | "periodicBackgroundSync"
      | "protectedMediaIdentifier"
      | "sensors"
      | "storageAccess"
      | "topLevelStorageAccess"
      | "videoCapture"
      | "videoCapturePanTiltZoom"
      | "wakeLockScreen"
      | "wakeLockSystem"
      | "windowManagement";
    export type PermissionSetting = "granted" | "denied" | "prompt";
    /**
     * Definition of PermissionDescriptor defined in the Permissions API:
     * https://w3c.github.io/permissions/#dom-permissiondescriptor.
     */
    export type PermissionDescriptor = {
      /**
       * Name of permission.
       * See https://cs.chromium.org/chromium/src/third_party/blink/renderer/modules/permissions/permission_descriptor.idl for valid permission names.
       */
      name: string;
      /**
       * For "midi" permission, may also specify sysex control.
       */
      sysex?: boolean | undefined;
      /**
       * For "push" permission, may specify userVisibleOnly.
       * Note that userVisibleOnly = true is the only currently supported type.
       */
      userVisibleOnly?: boolean | undefined;
      /**
       * For "clipboard" permission, may specify allowWithoutSanitization.
       */
      allowWithoutSanitization?: boolean | undefined;
      /**
       * For "camera" permission, may specify panTiltZoom.
       */
      panTiltZoom?: boolean | undefined;
    };
    /**
     * Browser command ids used by executeBrowserCommand.
     */
    export type BrowserCommandId = "openTabSearch" | "closeTabSearch";
    /**
     * Chrome histogram bucket.
     */
    export type Bucket = {
      /**
       * Minimum value (inclusive).
       */
      low: number;
      /**
       * Maximum value (exclusive).
       */
      high: number;
      /**
       * Number of samples.
       */
      count: number;
    };
    /**
     * Chrome histogram.
     */
    export type Histogram = {
      /**
       * Name.
       */
      name: string;
      /**
       * Sum of sample values.
       */
      sum: number;
      /**
       * Total number of samples.
       */
      count: number;
      /**
       * Buckets.
       */
      buckets: Bucket[];
    };
    /**
     * Fired when page is about to start a download.
     * @event `Browser.downloadWillBegin`
     */
    export type DownloadWillBeginEvent = {
      /**
       * Id of the frame that caused the download to begin.
       */
      frameId: Page.FrameId;
      /**
       * Global unique identifier of the download.
       */
      guid: string;
      /**
       * URL of the resource being downloaded.
       */
      url: string;
      /**
       * Suggested file name of the resource (the actual name of the file saved on disk may differ).
       */
      suggestedFilename: string;
    };
    /**
     * Fired when download makes progress. Last call has |done| == true.
     * @event `Browser.downloadProgress`
     */
    export type DownloadProgressEvent = {
      /**
       * Global unique identifier of the download.
       */
      guid: string;
      /**
       * Total expected bytes to download.
       */
      totalBytes: number;
      /**
       * Total bytes received.
       */
      receivedBytes: number;
      /**
       * Download status.
       */
      state: "inProgress" | "completed" | "canceled";
    };
    /**
     * Set permission settings for given origin.
     * @request `Browser.setPermission`
     */
    export type SetPermissionRequest = {
      /**
       * Descriptor of permission to override.
       */
      permission: PermissionDescriptor;
      /**
       * Setting of the permission.
       */
      setting: PermissionSetting;
      /**
       * Origin the permission applies to, all origins if not specified.
       */
      origin?: string | undefined;
      /**
       * Context to override. When omitted, default browser context is used.
       */
      browserContextId?: BrowserContextID | undefined;
    };
    /**
     * Set permission settings for given origin.
     * @response `Browser.setPermission`
     */
    export type SetPermissionResponse = {};
    /**
     * Grant specific permissions to the given origin and reject all others.
     * @request `Browser.grantPermissions`
     */
    export type GrantPermissionsRequest = {
      permissions: PermissionType[];
      /**
       * Origin the permission applies to, all origins if not specified.
       */
      origin?: string | undefined;
      /**
       * BrowserContext to override permissions. When omitted, default browser context is used.
       */
      browserContextId?: BrowserContextID | undefined;
    };
    /**
     * Grant specific permissions to the given origin and reject all others.
     * @response `Browser.grantPermissions`
     */
    export type GrantPermissionsResponse = {};
    /**
     * Reset all permission management for all origins.
     * @request `Browser.resetPermissions`
     */
    export type ResetPermissionsRequest = {
      /**
       * BrowserContext to reset permissions. When omitted, default browser context is used.
       */
      browserContextId?: BrowserContextID | undefined;
    };
    /**
     * Reset all permission management for all origins.
     * @response `Browser.resetPermissions`
     */
    export type ResetPermissionsResponse = {};
    /**
     * Set the behavior when downloading a file.
     * @request `Browser.setDownloadBehavior`
     */
    export type SetDownloadBehaviorRequest = {
      /**
       * Whether to allow all or deny all download requests, or use default Chrome behavior if
       * available (otherwise deny). |allowAndName| allows download and names files according to
       * their dowmload guids.
       */
      behavior: "deny" | "allow" | "allowAndName" | "default";
      /**
       * BrowserContext to set download behavior. When omitted, default browser context is used.
       */
      browserContextId?: BrowserContextID | undefined;
      /**
       * The default path to save downloaded files to. This is required if behavior is set to 'allow'
       * or 'allowAndName'.
       */
      downloadPath?: string | undefined;
      /**
       * Whether to emit download events (defaults to false).
       */
      eventsEnabled?: boolean | undefined;
    };
    /**
     * Set the behavior when downloading a file.
     * @response `Browser.setDownloadBehavior`
     */
    export type SetDownloadBehaviorResponse = {};
    /**
     * Cancel a download if in progress
     * @request `Browser.cancelDownload`
     */
    export type CancelDownloadRequest = {
      /**
       * Global unique identifier of the download.
       */
      guid: string;
      /**
       * BrowserContext to perform the action in. When omitted, default browser context is used.
       */
      browserContextId?: BrowserContextID | undefined;
    };
    /**
     * Cancel a download if in progress
     * @response `Browser.cancelDownload`
     */
    export type CancelDownloadResponse = {};
    /**
     * Close browser gracefully.
     * @request `Browser.close`
     */
    export type CloseRequest = {};
    /**
     * Close browser gracefully.
     * @response `Browser.close`
     */
    export type CloseResponse = {};
    /**
     * Crashes browser on the main thread.
     * @request `Browser.crash`
     */
    export type CrashRequest = {};
    /**
     * Crashes browser on the main thread.
     * @response `Browser.crash`
     */
    export type CrashResponse = {};
    /**
     * Crashes GPU process.
     * @request `Browser.crashGpuProcess`
     */
    export type CrashGpuProcessRequest = {};
    /**
     * Crashes GPU process.
     * @response `Browser.crashGpuProcess`
     */
    export type CrashGpuProcessResponse = {};
    /**
     * Returns version information.
     * @request `Browser.getVersion`
     */
    export type GetVersionRequest = {};
    /**
     * Returns version information.
     * @response `Browser.getVersion`
     */
    export type GetVersionResponse = {
      /**
       * Protocol version.
       */
      protocolVersion: string;
      /**
       * Product name.
       */
      product: string;
      /**
       * Product revision.
       */
      revision: string;
      /**
       * User-Agent.
       */
      userAgent: string;
      /**
       * V8 version.
       */
      jsVersion: string;
    };
    /**
     * Returns the command line switches for the browser process if, and only if
     * --enable-automation is on the commandline.
     * @request `Browser.getBrowserCommandLine`
     */
    export type GetBrowserCommandLineRequest = {};
    /**
     * Returns the command line switches for the browser process if, and only if
     * --enable-automation is on the commandline.
     * @response `Browser.getBrowserCommandLine`
     */
    export type GetBrowserCommandLineResponse = {
      /**
       * Commandline parameters
       */
      arguments: string[];
    };
    /**
     * Get Chrome histograms.
     * @request `Browser.getHistograms`
     */
    export type GetHistogramsRequest = {
      /**
       * Requested substring in name. Only histograms which have query as a
       * substring in their name are extracted. An empty or absent query returns
       * all histograms.
       */
      query?: string | undefined;
      /**
       * If true, retrieve delta since last delta call.
       */
      delta?: boolean | undefined;
    };
    /**
     * Get Chrome histograms.
     * @response `Browser.getHistograms`
     */
    export type GetHistogramsResponse = {
      /**
       * Histograms.
       */
      histograms: Histogram[];
    };
    /**
     * Get a Chrome histogram by name.
     * @request `Browser.getHistogram`
     */
    export type GetHistogramRequest = {
      /**
       * Requested histogram name.
       */
      name: string;
      /**
       * If true, retrieve delta since last delta call.
       */
      delta?: boolean | undefined;
    };
    /**
     * Get a Chrome histogram by name.
     * @response `Browser.getHistogram`
     */
    export type GetHistogramResponse = {
      /**
       * Histogram.
       */
      histogram: Histogram;
    };
    /**
     * Get position and size of the browser window.
     * @request `Browser.getWindowBounds`
     */
    export type GetWindowBoundsRequest = {
      /**
       * Browser window id.
       */
      windowId: WindowID;
    };
    /**
     * Get position and size of the browser window.
     * @response `Browser.getWindowBounds`
     */
    export type GetWindowBoundsResponse = {
      /**
       * Bounds information of the window. When window state is 'minimized', the restored window
       * position and size are returned.
       */
      bounds: Bounds;
    };
    /**
     * Get the browser window that contains the devtools target.
     * @request `Browser.getWindowForTarget`
     */
    export type GetWindowForTargetRequest = {
      /**
       * Devtools agent host id. If called as a part of the session, associated targetId is used.
       */
      targetId?: Target.TargetID | undefined;
    };
    /**
     * Get the browser window that contains the devtools target.
     * @response `Browser.getWindowForTarget`
     */
    export type GetWindowForTargetResponse = {
      /**
       * Browser window id.
       */
      windowId: WindowID;
      /**
       * Bounds information of the window. When window state is 'minimized', the restored window
       * position and size are returned.
       */
      bounds: Bounds;
    };
    /**
     * Set position and/or size of the browser window.
     * @request `Browser.setWindowBounds`
     */
    export type SetWindowBoundsRequest = {
      /**
       * Browser window id.
       */
      windowId: WindowID;
      /**
       * New window bounds. The 'minimized', 'maximized' and 'fullscreen' states cannot be combined
       * with 'left', 'top', 'width' or 'height'. Leaves unspecified fields unchanged.
       */
      bounds: Bounds;
    };
    /**
     * Set position and/or size of the browser window.
     * @response `Browser.setWindowBounds`
     */
    export type SetWindowBoundsResponse = {};
    /**
     * Set dock tile details, platform-specific.
     * @request `Browser.setDockTile`
     */
    export type SetDockTileRequest = {
      badgeLabel?: string | undefined;
      /**
       * Png encoded image. (Encoded as a base64 string when passed over JSON)
       */
      image?: string | undefined;
    };
    /**
     * Set dock tile details, platform-specific.
     * @response `Browser.setDockTile`
     */
    export type SetDockTileResponse = {};
    /**
     * Invoke custom browser commands used by telemetry.
     * @request `Browser.executeBrowserCommand`
     */
    export type ExecuteBrowserCommandRequest = {
      commandId: BrowserCommandId;
    };
    /**
     * Invoke custom browser commands used by telemetry.
     * @response `Browser.executeBrowserCommand`
     */
    export type ExecuteBrowserCommandResponse = {};
    /**
     * Allows a site to use privacy sandbox features that require enrollment
     * without the site actually being enrolled. Only supported on page targets.
     * @request `Browser.addPrivacySandboxEnrollmentOverride`
     */
    export type AddPrivacySandboxEnrollmentOverrideRequest = {
      url: string;
    };
    /**
     * Allows a site to use privacy sandbox features that require enrollment
     * without the site actually being enrolled. Only supported on page targets.
     * @response `Browser.addPrivacySandboxEnrollmentOverride`
     */
    export type AddPrivacySandboxEnrollmentOverrideResponse = {};
  }
  export namespace CacheStorage {
    /**
     * Unique identifier of the Cache object.
     */
    export type CacheId = string;
    /**
     * type of HTTP response cached
     */
    export type CachedResponseType = "basic" | "cors" | "default" | "error" | "opaqueResponse" | "opaqueRedirect";
    /**
     * Data entry.
     */
    export type DataEntry = {
      /**
       * Request URL.
       */
      requestURL: string;
      /**
       * Request method.
       */
      requestMethod: string;
      /**
       * Request headers
       */
      requestHeaders: Header[];
      /**
       * Number of seconds since epoch.
       */
      responseTime: number;
      /**
       * HTTP response status code.
       */
      responseStatus: number;
      /**
       * HTTP response status text.
       */
      responseStatusText: string;
      /**
       * HTTP response type
       */
      responseType: CachedResponseType;
      /**
       * Response headers
       */
      responseHeaders: Header[];
    };
    /**
     * Cache identifier.
     */
    export type Cache = {
      /**
       * An opaque unique id of the cache.
       */
      cacheId: CacheId;
      /**
       * Security origin of the cache.
       */
      securityOrigin: string;
      /**
       * Storage key of the cache.
       */
      storageKey: string;
      /**
       * Storage bucket of the cache.
       */
      storageBucket?: Storage.StorageBucket | undefined;
      /**
       * The name of the cache.
       */
      cacheName: string;
    };
    export type Header = {
      name: string;
      value: string;
    };
    /**
     * Cached response
     */
    export type CachedResponse = {
      /**
       * Entry content, base64-encoded. (Encoded as a base64 string when passed over JSON)
       */
      body: string;
    };
    /**
     * Deletes a cache.
     * @request `CacheStorage.deleteCache`
     */
    export type DeleteCacheRequest = {
      /**
       * Id of cache for deletion.
       */
      cacheId: CacheId;
    };
    /**
     * Deletes a cache.
     * @response `CacheStorage.deleteCache`
     */
    export type DeleteCacheResponse = {};
    /**
     * Deletes a cache entry.
     * @request `CacheStorage.deleteEntry`
     */
    export type DeleteEntryRequest = {
      /**
       * Id of cache where the entry will be deleted.
       */
      cacheId: CacheId;
      /**
       * URL spec of the request.
       */
      request: string;
    };
    /**
     * Deletes a cache entry.
     * @response `CacheStorage.deleteEntry`
     */
    export type DeleteEntryResponse = {};
    /**
     * Requests cache names.
     * @request `CacheStorage.requestCacheNames`
     */
    export type RequestCacheNamesRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
    };
    /**
     * Requests cache names.
     * @response `CacheStorage.requestCacheNames`
     */
    export type RequestCacheNamesResponse = {
      /**
       * Caches for the security origin.
       */
      caches: Cache[];
    };
    /**
     * Fetches cache entry.
     * @request `CacheStorage.requestCachedResponse`
     */
    export type RequestCachedResponseRequest = {
      /**
       * Id of cache that contains the entry.
       */
      cacheId: CacheId;
      /**
       * URL spec of the request.
       */
      requestURL: string;
      /**
       * headers of the request.
       */
      requestHeaders: Header[];
    };
    /**
     * Fetches cache entry.
     * @response `CacheStorage.requestCachedResponse`
     */
    export type RequestCachedResponseResponse = {
      /**
       * Response read from the cache.
       */
      response: CachedResponse;
    };
    /**
     * Requests data from cache.
     * @request `CacheStorage.requestEntries`
     */
    export type RequestEntriesRequest = {
      /**
       * ID of cache to get entries from.
       */
      cacheId: CacheId;
      /**
       * Number of records to skip.
       */
      skipCount?: number | undefined;
      /**
       * Number of records to fetch.
       */
      pageSize?: number | undefined;
      /**
       * If present, only return the entries containing this substring in the path
       */
      pathFilter?: string | undefined;
    };
    /**
     * Requests data from cache.
     * @response `CacheStorage.requestEntries`
     */
    export type RequestEntriesResponse = {
      /**
       * Array of object store data entries.
       */
      cacheDataEntries: DataEntry[];
      /**
       * Count of returned entries from this storage. If pathFilter is empty, it
       * is the count of all entries from this storage.
       */
      returnCount: number;
    };
  }
  export namespace Cast {
    export type Sink = {
      name: string;
      id: string;
      /**
       * Text describing the current session. Present only if there is an active
       * session on the sink.
       */
      session?: string | undefined;
    };
    /**
     * This is fired whenever the list of available sinks changes. A sink is a
     * device or a software surface that you can cast to.
     * @event `Cast.sinksUpdated`
     */
    export type SinksUpdatedEvent = {
      sinks: Sink[];
    };
    /**
     * This is fired whenever the outstanding issue/error message changes.
     * |issueMessage| is empty if there is no issue.
     * @event `Cast.issueUpdated`
     */
    export type IssueUpdatedEvent = {
      issueMessage: string;
    };
    /**
     * Starts observing for sinks that can be used for tab mirroring, and if set,
     * sinks compatible with |presentationUrl| as well. When sinks are found, a
     * |sinksUpdated| event is fired.
     * Also starts observing for issue messages. When an issue is added or removed,
     * an |issueUpdated| event is fired.
     * @request `Cast.enable`
     */
    export type EnableRequest = {
      presentationUrl?: string | undefined;
    };
    /**
     * Starts observing for sinks that can be used for tab mirroring, and if set,
     * sinks compatible with |presentationUrl| as well. When sinks are found, a
     * |sinksUpdated| event is fired.
     * Also starts observing for issue messages. When an issue is added or removed,
     * an |issueUpdated| event is fired.
     * @response `Cast.enable`
     */
    export type EnableResponse = {};
    /**
     * Stops observing for sinks and issues.
     * @request `Cast.disable`
     */
    export type DisableRequest = {};
    /**
     * Stops observing for sinks and issues.
     * @response `Cast.disable`
     */
    export type DisableResponse = {};
    /**
     * Sets a sink to be used when the web page requests the browser to choose a
     * sink via Presentation API, Remote Playback API, or Cast SDK.
     * @request `Cast.setSinkToUse`
     */
    export type SetSinkToUseRequest = {
      sinkName: string;
    };
    /**
     * Sets a sink to be used when the web page requests the browser to choose a
     * sink via Presentation API, Remote Playback API, or Cast SDK.
     * @response `Cast.setSinkToUse`
     */
    export type SetSinkToUseResponse = {};
    /**
     * Starts mirroring the desktop to the sink.
     * @request `Cast.startDesktopMirroring`
     */
    export type StartDesktopMirroringRequest = {
      sinkName: string;
    };
    /**
     * Starts mirroring the desktop to the sink.
     * @response `Cast.startDesktopMirroring`
     */
    export type StartDesktopMirroringResponse = {};
    /**
     * Starts mirroring the tab to the sink.
     * @request `Cast.startTabMirroring`
     */
    export type StartTabMirroringRequest = {
      sinkName: string;
    };
    /**
     * Starts mirroring the tab to the sink.
     * @response `Cast.startTabMirroring`
     */
    export type StartTabMirroringResponse = {};
    /**
     * Stops the active Cast session on the sink.
     * @request `Cast.stopCasting`
     */
    export type StopCastingRequest = {
      sinkName: string;
    };
    /**
     * Stops the active Cast session on the sink.
     * @response `Cast.stopCasting`
     */
    export type StopCastingResponse = {};
  }
  export namespace CSS {
    export type StyleSheetId = string;
    /**
     * Stylesheet type: "injected" for stylesheets injected via extension, "user-agent" for user-agent
     * stylesheets, "inspector" for stylesheets created by the inspector (i.e. those holding the "via
     * inspector" rules), "regular" for regular stylesheets.
     */
    export type StyleSheetOrigin = "injected" | "user-agent" | "inspector" | "regular";
    /**
     * CSS rule collection for a single pseudo style.
     */
    export type PseudoElementMatches = {
      /**
       * Pseudo element type.
       */
      pseudoType: DOM.PseudoType;
      /**
       * Pseudo element custom ident.
       */
      pseudoIdentifier?: string | undefined;
      /**
       * Matches of CSS rules applicable to the pseudo style.
       */
      matches: RuleMatch[];
    };
    /**
     * Inherited CSS rule collection from ancestor node.
     */
    export type InheritedStyleEntry = {
      /**
       * The ancestor node's inline style, if any, in the style inheritance chain.
       */
      inlineStyle?: CSSStyle | undefined;
      /**
       * Matches of CSS rules matching the ancestor node in the style inheritance chain.
       */
      matchedCSSRules: RuleMatch[];
    };
    /**
     * Inherited pseudo element matches from pseudos of an ancestor node.
     */
    export type InheritedPseudoElementMatches = {
      /**
       * Matches of pseudo styles from the pseudos of an ancestor node.
       */
      pseudoElements: PseudoElementMatches[];
    };
    /**
     * Match data for a CSS rule.
     */
    export type RuleMatch = {
      /**
       * CSS rule in the match.
       */
      rule: CSSRule;
      /**
       * Matching selector indices in the rule's selectorList selectors (0-based).
       */
      matchingSelectors: number[];
    };
    /**
     * Data for a simple selector (these are delimited by commas in a selector list).
     */
    export type Value = {
      /**
       * Value text.
       */
      text: string;
      /**
       * Value range in the underlying resource (if available).
       */
      range?: SourceRange | undefined;
      /**
       * Specificity of the selector.
       */
      specificity?: Specificity | undefined;
    };
    /**
     * Specificity:
     * https://drafts.csswg.org/selectors/#specificity-rules
     */
    export type Specificity = {
      /**
       * The a component, which represents the number of ID selectors.
       */
      a: number;
      /**
       * The b component, which represents the number of class selectors, attributes selectors, and
       * pseudo-classes.
       */
      b: number;
      /**
       * The c component, which represents the number of type selectors and pseudo-elements.
       */
      c: number;
    };
    /**
     * Selector list data.
     */
    export type SelectorList = {
      /**
       * Selectors in the list.
       */
      selectors: Value[];
      /**
       * Rule selector text.
       */
      text: string;
    };
    /**
     * CSS stylesheet metainformation.
     */
    export type CSSStyleSheetHeader = {
      /**
       * The stylesheet identifier.
       */
      styleSheetId: StyleSheetId;
      /**
       * Owner frame identifier.
       */
      frameId: Page.FrameId;
      /**
       * Stylesheet resource URL. Empty if this is a constructed stylesheet created using
       * new CSSStyleSheet() (but non-empty if this is a constructed sylesheet imported
       * as a CSS module script).
       */
      sourceURL: string;
      /**
       * URL of source map associated with the stylesheet (if any).
       */
      sourceMapURL?: string | undefined;
      /**
       * Stylesheet origin.
       */
      origin: StyleSheetOrigin;
      /**
       * Stylesheet title.
       */
      title: string;
      /**
       * The backend id for the owner node of the stylesheet.
       */
      ownerNode?: DOM.BackendNodeId | undefined;
      /**
       * Denotes whether the stylesheet is disabled.
       */
      disabled: boolean;
      /**
       * Whether the sourceURL field value comes from the sourceURL comment.
       */
      hasSourceURL?: boolean | undefined;
      /**
       * Whether this stylesheet is created for STYLE tag by parser. This flag is not set for
       * document.written STYLE tags.
       */
      isInline: boolean;
      /**
       * Whether this stylesheet is mutable. Inline stylesheets become mutable
       * after they have been modified via CSSOM API.
       * `<link>` element's stylesheets become mutable only if DevTools modifies them.
       * Constructed stylesheets (new CSSStyleSheet()) are mutable immediately after creation.
       */
      isMutable: boolean;
      /**
       * True if this stylesheet is created through new CSSStyleSheet() or imported as a
       * CSS module script.
       */
      isConstructed: boolean;
      /**
       * Line offset of the stylesheet within the resource (zero based).
       */
      startLine: number;
      /**
       * Column offset of the stylesheet within the resource (zero based).
       */
      startColumn: number;
      /**
       * Size of the content (in characters).
       */
      length: number;
      /**
       * Line offset of the end of the stylesheet within the resource (zero based).
       */
      endLine: number;
      /**
       * Column offset of the end of the stylesheet within the resource (zero based).
       */
      endColumn: number;
      /**
       * If the style sheet was loaded from a network resource, this indicates when the resource failed to load
       */
      loadingFailed?: boolean | undefined;
    };
    /**
     * CSS rule representation.
     */
    export type CSSRule = {
      /**
       * The css style sheet identifier (absent for user agent stylesheet and user-specified
       * stylesheet rules) this rule came from.
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * Rule selector data.
       */
      selectorList: SelectorList;
      /**
       * Array of selectors from ancestor style rules, sorted by distance from the current rule.
       */
      nestingSelectors?: string[] | undefined;
      /**
       * Parent stylesheet's origin.
       */
      origin: StyleSheetOrigin;
      /**
       * Associated style declaration.
       */
      style: CSSStyle;
      /**
       * Media list array (for rules involving media queries). The array enumerates media queries
       * starting with the innermost one, going outwards.
       */
      media?: CSSMedia[] | undefined;
      /**
       * Container query list array (for rules involving container queries).
       * The array enumerates container queries starting with the innermost one, going outwards.
       */
      containerQueries?: CSSContainerQuery[] | undefined;
      /**
       * @supports CSS at-rule array.
       * The array enumerates @supports at-rules starting with the innermost one, going outwards.
       */
      supports?: CSSSupports[] | undefined;
      /**
       * Cascade layer array. Contains the layer hierarchy that this rule belongs to starting
       * with the innermost layer and going outwards.
       */
      layers?: CSSLayer[] | undefined;
      /**
       * @scope CSS at-rule array.
       * The array enumerates @scope at-rules starting with the innermost one, going outwards.
       */
      scopes?: CSSScope[] | undefined;
      /**
       * The array keeps the types of ancestor CSSRules from the innermost going outwards.
       */
      ruleTypes?: CSSRuleType[] | undefined;
    };
    /**
     * Enum indicating the type of a CSS rule, used to represent the order of a style rule's ancestors.
     * This list only contains rule types that are collected during the ancestor rule collection.
     */
    export type CSSRuleType = "MediaRule" | "SupportsRule" | "ContainerRule" | "LayerRule" | "ScopeRule" | "StyleRule";
    /**
     * CSS coverage information.
     */
    export type RuleUsage = {
      /**
       * The css style sheet identifier (absent for user agent stylesheet and user-specified
       * stylesheet rules) this rule came from.
       */
      styleSheetId: StyleSheetId;
      /**
       * Offset of the start of the rule (including selector) from the beginning of the stylesheet.
       */
      startOffset: number;
      /**
       * Offset of the end of the rule body from the beginning of the stylesheet.
       */
      endOffset: number;
      /**
       * Indicates whether the rule was actually used by some element in the page.
       */
      used: boolean;
    };
    /**
     * Text range within a resource. All numbers are zero-based.
     */
    export type SourceRange = {
      /**
       * Start line of range.
       */
      startLine: number;
      /**
       * Start column of range (inclusive).
       */
      startColumn: number;
      /**
       * End line of range
       */
      endLine: number;
      /**
       * End column of range (exclusive).
       */
      endColumn: number;
    };
    export type ShorthandEntry = {
      /**
       * Shorthand name.
       */
      name: string;
      /**
       * Shorthand value.
       */
      value: string;
      /**
       * Whether the property has "!important" annotation (implies `false` if absent).
       */
      important?: boolean | undefined;
    };
    export type CSSComputedStyleProperty = {
      /**
       * Computed style property name.
       */
      name: string;
      /**
       * Computed style property value.
       */
      value: string;
    };
    /**
     * CSS style representation.
     */
    export type CSSStyle = {
      /**
       * The css style sheet identifier (absent for user agent stylesheet and user-specified
       * stylesheet rules) this rule came from.
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * CSS properties in the style.
       */
      cssProperties: CSSProperty[];
      /**
       * Computed values for all shorthands found in the style.
       */
      shorthandEntries: ShorthandEntry[];
      /**
       * Style declaration text (if available).
       */
      cssText?: string | undefined;
      /**
       * Style declaration range in the enclosing stylesheet (if available).
       */
      range?: SourceRange | undefined;
    };
    /**
     * CSS property declaration data.
     */
    export type CSSProperty = {
      /**
       * The property name.
       */
      name: string;
      /**
       * The property value.
       */
      value: string;
      /**
       * Whether the property has "!important" annotation (implies `false` if absent).
       */
      important?: boolean | undefined;
      /**
       * Whether the property is implicit (implies `false` if absent).
       */
      implicit?: boolean | undefined;
      /**
       * The full property text as specified in the style.
       */
      text?: string | undefined;
      /**
       * Whether the property is understood by the browser (implies `true` if absent).
       */
      parsedOk?: boolean | undefined;
      /**
       * Whether the property is disabled by the user (present for source-based properties only).
       */
      disabled?: boolean | undefined;
      /**
       * The entire property range in the enclosing style declaration (if available).
       */
      range?: SourceRange | undefined;
      /**
       * Parsed longhand components of this property if it is a shorthand.
       * This field will be empty if the given property is not a shorthand.
       */
      longhandProperties?: CSSProperty[] | undefined;
    };
    /**
     * CSS media rule descriptor.
     */
    export type CSSMedia = {
      /**
       * Media query text.
       */
      text: string;
      /**
       * Source of the media query: "mediaRule" if specified by a @media rule, "importRule" if
       * specified by an @import rule, "linkedSheet" if specified by a "media" attribute in a linked
       * stylesheet's LINK tag, "inlineSheet" if specified by a "media" attribute in an inline
       * stylesheet's STYLE tag.
       */
      source: "mediaRule" | "importRule" | "linkedSheet" | "inlineSheet";
      /**
       * URL of the document containing the media query description.
       */
      sourceURL?: string | undefined;
      /**
       * The associated rule (@media or @import) header range in the enclosing stylesheet (if
       * available).
       */
      range?: SourceRange | undefined;
      /**
       * Identifier of the stylesheet containing this object (if exists).
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * Array of media queries.
       */
      mediaList?: MediaQuery[] | undefined;
    };
    /**
     * Media query descriptor.
     */
    export type MediaQuery = {
      /**
       * Array of media query expressions.
       */
      expressions: MediaQueryExpression[];
      /**
       * Whether the media query condition is satisfied.
       */
      active: boolean;
    };
    /**
     * Media query expression descriptor.
     */
    export type MediaQueryExpression = {
      /**
       * Media query expression value.
       */
      value: number;
      /**
       * Media query expression units.
       */
      unit: string;
      /**
       * Media query expression feature.
       */
      feature: string;
      /**
       * The associated range of the value text in the enclosing stylesheet (if available).
       */
      valueRange?: SourceRange | undefined;
      /**
       * Computed length of media query expression (if applicable).
       */
      computedLength?: number | undefined;
    };
    /**
     * CSS container query rule descriptor.
     */
    export type CSSContainerQuery = {
      /**
       * Container query text.
       */
      text: string;
      /**
       * The associated rule header range in the enclosing stylesheet (if
       * available).
       */
      range?: SourceRange | undefined;
      /**
       * Identifier of the stylesheet containing this object (if exists).
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * Optional name for the container.
       */
      name?: string | undefined;
      /**
       * Optional physical axes queried for the container.
       */
      physicalAxes?: DOM.PhysicalAxes | undefined;
      /**
       * Optional logical axes queried for the container.
       */
      logicalAxes?: DOM.LogicalAxes | undefined;
    };
    /**
     * CSS Supports at-rule descriptor.
     */
    export type CSSSupports = {
      /**
       * Supports rule text.
       */
      text: string;
      /**
       * Whether the supports condition is satisfied.
       */
      active: boolean;
      /**
       * The associated rule header range in the enclosing stylesheet (if
       * available).
       */
      range?: SourceRange | undefined;
      /**
       * Identifier of the stylesheet containing this object (if exists).
       */
      styleSheetId?: StyleSheetId | undefined;
    };
    /**
     * CSS Scope at-rule descriptor.
     */
    export type CSSScope = {
      /**
       * Scope rule text.
       */
      text: string;
      /**
       * The associated rule header range in the enclosing stylesheet (if
       * available).
       */
      range?: SourceRange | undefined;
      /**
       * Identifier of the stylesheet containing this object (if exists).
       */
      styleSheetId?: StyleSheetId | undefined;
    };
    /**
     * CSS Layer at-rule descriptor.
     */
    export type CSSLayer = {
      /**
       * Layer name.
       */
      text: string;
      /**
       * The associated rule header range in the enclosing stylesheet (if
       * available).
       */
      range?: SourceRange | undefined;
      /**
       * Identifier of the stylesheet containing this object (if exists).
       */
      styleSheetId?: StyleSheetId | undefined;
    };
    /**
     * CSS Layer data.
     */
    export type CSSLayerData = {
      /**
       * Layer name.
       */
      name: string;
      /**
       * Direct sub-layers
       */
      subLayers?: CSSLayerData[] | undefined;
      /**
       * Layer order. The order determines the order of the layer in the cascade order.
       * A higher number has higher priority in the cascade order.
       */
      order: number;
    };
    /**
     * Information about amount of glyphs that were rendered with given font.
     */
    export type PlatformFontUsage = {
      /**
       * Font's family name reported by platform.
       */
      familyName: string;
      /**
       * Font's PostScript name reported by platform.
       */
      postScriptName: string;
      /**
       * Indicates if the font was downloaded or resolved locally.
       */
      isCustomFont: boolean;
      /**
       * Amount of glyphs that were rendered with this font.
       */
      glyphCount: number;
    };
    /**
     * Information about font variation axes for variable fonts
     */
    export type FontVariationAxis = {
      /**
       * The font-variation-setting tag (a.k.a. "axis tag").
       */
      tag: string;
      /**
       * Human-readable variation name in the default language (normally, "en").
       */
      name: string;
      /**
       * The minimum value (inclusive) the font supports for this tag.
       */
      minValue: number;
      /**
       * The maximum value (inclusive) the font supports for this tag.
       */
      maxValue: number;
      /**
       * The default value.
       */
      defaultValue: number;
    };
    /**
     * Properties of a web font: https://www.w3.org/TR/2008/REC-CSS2-20080411/fonts.html#font-descriptions
     * and additional information such as platformFontFamily and fontVariationAxes.
     */
    export type FontFace = {
      /**
       * The font-family.
       */
      fontFamily: string;
      /**
       * The font-style.
       */
      fontStyle: string;
      /**
       * The font-variant.
       */
      fontVariant: string;
      /**
       * The font-weight.
       */
      fontWeight: string;
      /**
       * The font-stretch.
       */
      fontStretch: string;
      /**
       * The font-display.
       */
      fontDisplay: string;
      /**
       * The unicode-range.
       */
      unicodeRange: string;
      /**
       * The src.
       */
      src: string;
      /**
       * The resolved platform font family
       */
      platformFontFamily: string;
      /**
       * Available variation settings (a.k.a. "axes").
       */
      fontVariationAxes?: FontVariationAxis[] | undefined;
    };
    /**
     * CSS try rule representation.
     */
    export type CSSTryRule = {
      /**
       * The css style sheet identifier (absent for user agent stylesheet and user-specified
       * stylesheet rules) this rule came from.
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * Parent stylesheet's origin.
       */
      origin: StyleSheetOrigin;
      /**
       * Associated style declaration.
       */
      style: CSSStyle;
    };
    /**
     * CSS position-fallback rule representation.
     */
    export type CSSPositionFallbackRule = {
      name: Value;
      /**
       * List of keyframes.
       */
      tryRules: CSSTryRule[];
    };
    /**
     * CSS keyframes rule representation.
     */
    export type CSSKeyframesRule = {
      /**
       * Animation name.
       */
      animationName: Value;
      /**
       * List of keyframes.
       */
      keyframes: CSSKeyframeRule[];
    };
    /**
     * Representation of a custom property registration through CSS.registerProperty
     */
    export type CSSPropertyRegistration = {
      propertyName: string;
      initialValue?: Value | undefined;
      inherits: boolean;
      syntax: string;
    };
    /**
     * CSS font-palette-values rule representation.
     */
    export type CSSFontPaletteValuesRule = {
      /**
       * The css style sheet identifier (absent for user agent stylesheet and user-specified
       * stylesheet rules) this rule came from.
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * Parent stylesheet's origin.
       */
      origin: StyleSheetOrigin;
      /**
       * Associated font palette name.
       */
      fontPaletteName: Value;
      /**
       * Associated style declaration.
       */
      style: CSSStyle;
    };
    /**
     * CSS property at-rule representation.
     */
    export type CSSPropertyRule = {
      /**
       * The css style sheet identifier (absent for user agent stylesheet and user-specified
       * stylesheet rules) this rule came from.
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * Parent stylesheet's origin.
       */
      origin: StyleSheetOrigin;
      /**
       * Associated property name.
       */
      propertyName: Value;
      /**
       * Associated style declaration.
       */
      style: CSSStyle;
    };
    /**
     * CSS keyframe rule representation.
     */
    export type CSSKeyframeRule = {
      /**
       * The css style sheet identifier (absent for user agent stylesheet and user-specified
       * stylesheet rules) this rule came from.
       */
      styleSheetId?: StyleSheetId | undefined;
      /**
       * Parent stylesheet's origin.
       */
      origin: StyleSheetOrigin;
      /**
       * Associated key text.
       */
      keyText: Value;
      /**
       * Associated style declaration.
       */
      style: CSSStyle;
    };
    /**
     * A descriptor of operation to mutate style declaration text.
     */
    export type StyleDeclarationEdit = {
      /**
       * The css style sheet identifier.
       */
      styleSheetId: StyleSheetId;
      /**
       * The range of the style text in the enclosing stylesheet.
       */
      range: SourceRange;
      /**
       * New style text.
       */
      text: string;
    };
    /**
     * Fires whenever a web font is updated.  A non-empty font parameter indicates a successfully loaded
     * web font.
     * @event `CSS.fontsUpdated`
     */
    export type FontsUpdatedEvent = {
      /**
       * The web font that has loaded.
       */
      font?: FontFace | undefined;
    };
    /**
     * Fires whenever a MediaQuery result changes (for example, after a browser window has been
     * resized.) The current implementation considers only viewport-dependent media features.
     * @event `CSS.mediaQueryResultChanged`
     */
    export type MediaQueryResultChangedEvent = {};
    /**
     * Fired whenever an active document stylesheet is added.
     * @event `CSS.styleSheetAdded`
     */
    export type StyleSheetAddedEvent = {
      /**
       * Added stylesheet metainfo.
       */
      header: CSSStyleSheetHeader;
    };
    /**
     * Fired whenever a stylesheet is changed as a result of the client operation.
     * @event `CSS.styleSheetChanged`
     */
    export type StyleSheetChangedEvent = {
      styleSheetId: StyleSheetId;
    };
    /**
     * Fired whenever an active document stylesheet is removed.
     * @event `CSS.styleSheetRemoved`
     */
    export type StyleSheetRemovedEvent = {
      /**
       * Identifier of the removed stylesheet.
       */
      styleSheetId: StyleSheetId;
    };
    /**
     * Inserts a new rule with the given `ruleText` in a stylesheet with given `styleSheetId`, at the
     * position specified by `location`.
     * @request `CSS.addRule`
     */
    export type AddRuleRequest = {
      /**
       * The css style sheet identifier where a new rule should be inserted.
       */
      styleSheetId: StyleSheetId;
      /**
       * The text of a new rule.
       */
      ruleText: string;
      /**
       * Text position of a new rule in the target style sheet.
       */
      location: SourceRange;
      /**
       * NodeId for the DOM node in whose context custom property declarations for registered properties should be
       * validated. If omitted, declarations in the new rule text can only be validated statically, which may produce
       * incorrect results if the declaration contains a var() for example.
       */
      nodeForPropertySyntaxValidation?: DOM.NodeId | undefined;
    };
    /**
     * Inserts a new rule with the given `ruleText` in a stylesheet with given `styleSheetId`, at the
     * position specified by `location`.
     * @response `CSS.addRule`
     */
    export type AddRuleResponse = {
      /**
       * The newly created rule.
       */
      rule: CSSRule;
    };
    /**
     * Returns all class names from specified stylesheet.
     * @request `CSS.collectClassNames`
     */
    export type CollectClassNamesRequest = {
      styleSheetId: StyleSheetId;
    };
    /**
     * Returns all class names from specified stylesheet.
     * @response `CSS.collectClassNames`
     */
    export type CollectClassNamesResponse = {
      /**
       * Class name list.
       */
      classNames: string[];
    };
    /**
     * Creates a new special "via-inspector" stylesheet in the frame with given `frameId`.
     * @request `CSS.createStyleSheet`
     */
    export type CreateStyleSheetRequest = {
      /**
       * Identifier of the frame where "via-inspector" stylesheet should be created.
       */
      frameId: Page.FrameId;
    };
    /**
     * Creates a new special "via-inspector" stylesheet in the frame with given `frameId`.
     * @response `CSS.createStyleSheet`
     */
    export type CreateStyleSheetResponse = {
      /**
       * Identifier of the created "via-inspector" stylesheet.
       */
      styleSheetId: StyleSheetId;
    };
    /**
     * Disables the CSS agent for the given page.
     * @request `CSS.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables the CSS agent for the given page.
     * @response `CSS.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables the CSS agent for the given page. Clients should not assume that the CSS agent has been
     * enabled until the result of this command is received.
     * @request `CSS.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables the CSS agent for the given page. Clients should not assume that the CSS agent has been
     * enabled until the result of this command is received.
     * @response `CSS.enable`
     */
    export type EnableResponse = {};
    /**
     * Ensures that the given node will have specified pseudo-classes whenever its style is computed by
     * the browser.
     * @request `CSS.forcePseudoState`
     */
    export type ForcePseudoStateRequest = {
      /**
       * The element id for which to force the pseudo state.
       */
      nodeId: DOM.NodeId;
      /**
       * Element pseudo classes to force when computing the element's style.
       */
      forcedPseudoClasses: string[];
    };
    /**
     * Ensures that the given node will have specified pseudo-classes whenever its style is computed by
     * the browser.
     * @response `CSS.forcePseudoState`
     */
    export type ForcePseudoStateResponse = {};
    /**
     * undefined
     * @request `CSS.getBackgroundColors`
     */
    export type GetBackgroundColorsRequest = {
      /**
       * Id of the node to get background colors for.
       */
      nodeId: DOM.NodeId;
    };
    /**
     * undefined
     * @response `CSS.getBackgroundColors`
     */
    export type GetBackgroundColorsResponse = {
      /**
       * The range of background colors behind this element, if it contains any visible text. If no
       * visible text is present, this will be undefined. In the case of a flat background color,
       * this will consist of simply that color. In the case of a gradient, this will consist of each
       * of the color stops. For anything more complicated, this will be an empty array. Images will
       * be ignored (as if the image had failed to load).
       */
      backgroundColors?: string[] | undefined;
      /**
       * The computed font size for this node, as a CSS computed value string (e.g. '12px').
       */
      computedFontSize?: string | undefined;
      /**
       * The computed font weight for this node, as a CSS computed value string (e.g. 'normal' or
       * '100').
       */
      computedFontWeight?: string | undefined;
    };
    /**
     * Returns the computed style for a DOM node identified by `nodeId`.
     * @request `CSS.getComputedStyleForNode`
     */
    export type GetComputedStyleForNodeRequest = {
      nodeId: DOM.NodeId;
    };
    /**
     * Returns the computed style for a DOM node identified by `nodeId`.
     * @response `CSS.getComputedStyleForNode`
     */
    export type GetComputedStyleForNodeResponse = {
      /**
       * Computed style for the specified DOM node.
       */
      computedStyle: CSSComputedStyleProperty[];
    };
    /**
     * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM
     * attributes) for a DOM node identified by `nodeId`.
     * @request `CSS.getInlineStylesForNode`
     */
    export type GetInlineStylesForNodeRequest = {
      nodeId: DOM.NodeId;
    };
    /**
     * Returns the styles defined inline (explicitly in the "style" attribute and implicitly, using DOM
     * attributes) for a DOM node identified by `nodeId`.
     * @response `CSS.getInlineStylesForNode`
     */
    export type GetInlineStylesForNodeResponse = {
      /**
       * Inline style for the specified DOM node.
       */
      inlineStyle?: CSSStyle | undefined;
      /**
       * Attribute-defined element style (e.g. resulting from "width=20 height=100%").
       */
      attributesStyle?: CSSStyle | undefined;
    };
    /**
     * Returns requested styles for a DOM node identified by `nodeId`.
     * @request `CSS.getMatchedStylesForNode`
     */
    export type GetMatchedStylesForNodeRequest = {
      nodeId: DOM.NodeId;
    };
    /**
     * Returns requested styles for a DOM node identified by `nodeId`.
     * @response `CSS.getMatchedStylesForNode`
     */
    export type GetMatchedStylesForNodeResponse = {
      /**
       * Inline style for the specified DOM node.
       */
      inlineStyle?: CSSStyle | undefined;
      /**
       * Attribute-defined element style (e.g. resulting from "width=20 height=100%").
       */
      attributesStyle?: CSSStyle | undefined;
      /**
       * CSS rules matching this node, from all applicable stylesheets.
       */
      matchedCSSRules?: RuleMatch[] | undefined;
      /**
       * Pseudo style matches for this node.
       */
      pseudoElements?: PseudoElementMatches[] | undefined;
      /**
       * A chain of inherited styles (from the immediate node parent up to the DOM tree root).
       */
      inherited?: InheritedStyleEntry[] | undefined;
      /**
       * A chain of inherited pseudo element styles (from the immediate node parent up to the DOM tree root).
       */
      inheritedPseudoElements?: InheritedPseudoElementMatches[] | undefined;
      /**
       * A list of CSS keyframed animations matching this node.
       */
      cssKeyframesRules?: CSSKeyframesRule[] | undefined;
      /**
       * A list of CSS position fallbacks matching this node.
       */
      cssPositionFallbackRules?: CSSPositionFallbackRule[] | undefined;
      /**
       * A list of CSS at-property rules matching this node.
       */
      cssPropertyRules?: CSSPropertyRule[] | undefined;
      /**
       * A list of CSS property registrations matching this node.
       */
      cssPropertyRegistrations?: CSSPropertyRegistration[] | undefined;
      /**
       * A font-palette-values rule matching this node.
       */
      cssFontPaletteValuesRule?: CSSFontPaletteValuesRule | undefined;
      /**
       * Id of the first parent element that does not have display: contents.
       */
      parentLayoutNodeId?: DOM.NodeId | undefined;
    };
    /**
     * Returns all media queries parsed by the rendering engine.
     * @request `CSS.getMediaQueries`
     */
    export type GetMediaQueriesRequest = {};
    /**
     * Returns all media queries parsed by the rendering engine.
     * @response `CSS.getMediaQueries`
     */
    export type GetMediaQueriesResponse = {
      medias: CSSMedia[];
    };
    /**
     * Requests information about platform fonts which we used to render child TextNodes in the given
     * node.
     * @request `CSS.getPlatformFontsForNode`
     */
    export type GetPlatformFontsForNodeRequest = {
      nodeId: DOM.NodeId;
    };
    /**
     * Requests information about platform fonts which we used to render child TextNodes in the given
     * node.
     * @response `CSS.getPlatformFontsForNode`
     */
    export type GetPlatformFontsForNodeResponse = {
      /**
       * Usage statistics for every employed platform font.
       */
      fonts: PlatformFontUsage[];
    };
    /**
     * Returns the current textual content for a stylesheet.
     * @request `CSS.getStyleSheetText`
     */
    export type GetStyleSheetTextRequest = {
      styleSheetId: StyleSheetId;
    };
    /**
     * Returns the current textual content for a stylesheet.
     * @response `CSS.getStyleSheetText`
     */
    export type GetStyleSheetTextResponse = {
      /**
       * The stylesheet text.
       */
      text: string;
    };
    /**
     * Returns all layers parsed by the rendering engine for the tree scope of a node.
     * Given a DOM element identified by nodeId, getLayersForNode returns the root
     * layer for the nearest ancestor document or shadow root. The layer root contains
     * the full layer tree for the tree scope and their ordering.
     * @request `CSS.getLayersForNode`
     */
    export type GetLayersForNodeRequest = {
      nodeId: DOM.NodeId;
    };
    /**
     * Returns all layers parsed by the rendering engine for the tree scope of a node.
     * Given a DOM element identified by nodeId, getLayersForNode returns the root
     * layer for the nearest ancestor document or shadow root. The layer root contains
     * the full layer tree for the tree scope and their ordering.
     * @response `CSS.getLayersForNode`
     */
    export type GetLayersForNodeResponse = {
      rootLayer: CSSLayerData;
    };
    /**
     * Starts tracking the given computed styles for updates. The specified array of properties
     * replaces the one previously specified. Pass empty array to disable tracking.
     * Use takeComputedStyleUpdates to retrieve the list of nodes that had properties modified.
     * The changes to computed style properties are only tracked for nodes pushed to the front-end
     * by the DOM agent. If no changes to the tracked properties occur after the node has been pushed
     * to the front-end, no updates will be issued for the node.
     * @request `CSS.trackComputedStyleUpdates`
     */
    export type TrackComputedStyleUpdatesRequest = {
      propertiesToTrack: CSSComputedStyleProperty[];
    };
    /**
     * Starts tracking the given computed styles for updates. The specified array of properties
     * replaces the one previously specified. Pass empty array to disable tracking.
     * Use takeComputedStyleUpdates to retrieve the list of nodes that had properties modified.
     * The changes to computed style properties are only tracked for nodes pushed to the front-end
     * by the DOM agent. If no changes to the tracked properties occur after the node has been pushed
     * to the front-end, no updates will be issued for the node.
     * @response `CSS.trackComputedStyleUpdates`
     */
    export type TrackComputedStyleUpdatesResponse = {};
    /**
     * Polls the next batch of computed style updates.
     * @request `CSS.takeComputedStyleUpdates`
     */
    export type TakeComputedStyleUpdatesRequest = {};
    /**
     * Polls the next batch of computed style updates.
     * @response `CSS.takeComputedStyleUpdates`
     */
    export type TakeComputedStyleUpdatesResponse = {
      /**
       * The list of node Ids that have their tracked computed styles updated.
       */
      nodeIds: DOM.NodeId[];
    };
    /**
     * Find a rule with the given active property for the given node and set the new value for this
     * property
     * @request `CSS.setEffectivePropertyValueForNode`
     */
    export type SetEffectivePropertyValueForNodeRequest = {
      /**
       * The element id for which to set property.
       */
      nodeId: DOM.NodeId;
      propertyName: string;
      value: string;
    };
    /**
     * Find a rule with the given active property for the given node and set the new value for this
     * property
     * @response `CSS.setEffectivePropertyValueForNode`
     */
    export type SetEffectivePropertyValueForNodeResponse = {};
    /**
     * Modifies the property rule property name.
     * @request `CSS.setPropertyRulePropertyName`
     */
    export type SetPropertyRulePropertyNameRequest = {
      styleSheetId: StyleSheetId;
      range: SourceRange;
      propertyName: string;
    };
    /**
     * Modifies the property rule property name.
     * @response `CSS.setPropertyRulePropertyName`
     */
    export type SetPropertyRulePropertyNameResponse = {
      /**
       * The resulting key text after modification.
       */
      propertyName: Value;
    };
    /**
     * Modifies the keyframe rule key text.
     * @request `CSS.setKeyframeKey`
     */
    export type SetKeyframeKeyRequest = {
      styleSheetId: StyleSheetId;
      range: SourceRange;
      keyText: string;
    };
    /**
     * Modifies the keyframe rule key text.
     * @response `CSS.setKeyframeKey`
     */
    export type SetKeyframeKeyResponse = {
      /**
       * The resulting key text after modification.
       */
      keyText: Value;
    };
    /**
     * Modifies the rule selector.
     * @request `CSS.setMediaText`
     */
    export type SetMediaTextRequest = {
      styleSheetId: StyleSheetId;
      range: SourceRange;
      text: string;
    };
    /**
     * Modifies the rule selector.
     * @response `CSS.setMediaText`
     */
    export type SetMediaTextResponse = {
      /**
       * The resulting CSS media rule after modification.
       */
      media: CSSMedia;
    };
    /**
     * Modifies the expression of a container query.
     * @request `CSS.setContainerQueryText`
     */
    export type SetContainerQueryTextRequest = {
      styleSheetId: StyleSheetId;
      range: SourceRange;
      text: string;
    };
    /**
     * Modifies the expression of a container query.
     * @response `CSS.setContainerQueryText`
     */
    export type SetContainerQueryTextResponse = {
      /**
       * The resulting CSS container query rule after modification.
       */
      containerQuery: CSSContainerQuery;
    };
    /**
     * Modifies the expression of a supports at-rule.
     * @request `CSS.setSupportsText`
     */
    export type SetSupportsTextRequest = {
      styleSheetId: StyleSheetId;
      range: SourceRange;
      text: string;
    };
    /**
     * Modifies the expression of a supports at-rule.
     * @response `CSS.setSupportsText`
     */
    export type SetSupportsTextResponse = {
      /**
       * The resulting CSS Supports rule after modification.
       */
      supports: CSSSupports;
    };
    /**
     * Modifies the expression of a scope at-rule.
     * @request `CSS.setScopeText`
     */
    export type SetScopeTextRequest = {
      styleSheetId: StyleSheetId;
      range: SourceRange;
      text: string;
    };
    /**
     * Modifies the expression of a scope at-rule.
     * @response `CSS.setScopeText`
     */
    export type SetScopeTextResponse = {
      /**
       * The resulting CSS Scope rule after modification.
       */
      scope: CSSScope;
    };
    /**
     * Modifies the rule selector.
     * @request `CSS.setRuleSelector`
     */
    export type SetRuleSelectorRequest = {
      styleSheetId: StyleSheetId;
      range: SourceRange;
      selector: string;
    };
    /**
     * Modifies the rule selector.
     * @response `CSS.setRuleSelector`
     */
    export type SetRuleSelectorResponse = {
      /**
       * The resulting selector list after modification.
       */
      selectorList: SelectorList;
    };
    /**
     * Sets the new stylesheet text.
     * @request `CSS.setStyleSheetText`
     */
    export type SetStyleSheetTextRequest = {
      styleSheetId: StyleSheetId;
      text: string;
    };
    /**
     * Sets the new stylesheet text.
     * @response `CSS.setStyleSheetText`
     */
    export type SetStyleSheetTextResponse = {
      /**
       * URL of source map associated with script (if any).
       */
      sourceMapURL?: string | undefined;
    };
    /**
     * Applies specified style edits one after another in the given order.
     * @request `CSS.setStyleTexts`
     */
    export type SetStyleTextsRequest = {
      edits: StyleDeclarationEdit[];
      /**
       * NodeId for the DOM node in whose context custom property declarations for registered properties should be
       * validated. If omitted, declarations in the new rule text can only be validated statically, which may produce
       * incorrect results if the declaration contains a var() for example.
       */
      nodeForPropertySyntaxValidation?: DOM.NodeId | undefined;
    };
    /**
     * Applies specified style edits one after another in the given order.
     * @response `CSS.setStyleTexts`
     */
    export type SetStyleTextsResponse = {
      /**
       * The resulting styles after modification.
       */
      styles: CSSStyle[];
    };
    /**
     * Enables the selector recording.
     * @request `CSS.startRuleUsageTracking`
     */
    export type StartRuleUsageTrackingRequest = {};
    /**
     * Enables the selector recording.
     * @response `CSS.startRuleUsageTracking`
     */
    export type StartRuleUsageTrackingResponse = {};
    /**
     * Stop tracking rule usage and return the list of rules that were used since last call to
     * `takeCoverageDelta` (or since start of coverage instrumentation).
     * @request `CSS.stopRuleUsageTracking`
     */
    export type StopRuleUsageTrackingRequest = {};
    /**
     * Stop tracking rule usage and return the list of rules that were used since last call to
     * `takeCoverageDelta` (or since start of coverage instrumentation).
     * @response `CSS.stopRuleUsageTracking`
     */
    export type StopRuleUsageTrackingResponse = {
      ruleUsage: RuleUsage[];
    };
    /**
     * Obtain list of rules that became used since last call to this method (or since start of coverage
     * instrumentation).
     * @request `CSS.takeCoverageDelta`
     */
    export type TakeCoverageDeltaRequest = {};
    /**
     * Obtain list of rules that became used since last call to this method (or since start of coverage
     * instrumentation).
     * @response `CSS.takeCoverageDelta`
     */
    export type TakeCoverageDeltaResponse = {
      coverage: RuleUsage[];
      /**
       * Monotonically increasing time, in seconds.
       */
      timestamp: number;
    };
    /**
     * Enables/disables rendering of local CSS fonts (enabled by default).
     * @request `CSS.setLocalFontsEnabled`
     */
    export type SetLocalFontsEnabledRequest = {
      /**
       * Whether rendering of local fonts is enabled.
       */
      enabled: boolean;
    };
    /**
     * Enables/disables rendering of local CSS fonts (enabled by default).
     * @response `CSS.setLocalFontsEnabled`
     */
    export type SetLocalFontsEnabledResponse = {};
  }
  export namespace Database {
    /**
     * Unique identifier of Database object.
     */
    export type DatabaseId = string;
    /**
     * Database object.
     */
    export type Database = {
      /**
       * Database ID.
       */
      id: DatabaseId;
      /**
       * Database domain.
       */
      domain: string;
      /**
       * Database name.
       */
      name: string;
      /**
       * Database version.
       */
      version: string;
    };
    /**
     * Database error.
     */
    export type Error = {
      /**
       * Error message.
       */
      message: string;
      /**
       * Error code.
       */
      code: number;
    };
    /**
     * undefined
     * @event `Database.addDatabase`
     */
    export type AddDatabaseEvent = {
      database: Database;
    };
    /**
     * Disables database tracking, prevents database events from being sent to the client.
     * @request `Database.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables database tracking, prevents database events from being sent to the client.
     * @response `Database.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables database tracking, database events will now be delivered to the client.
     * @request `Database.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables database tracking, database events will now be delivered to the client.
     * @response `Database.enable`
     */
    export type EnableResponse = {};
    /**
     * undefined
     * @request `Database.executeSQL`
     */
    export type ExecuteSQLRequest = {
      databaseId: DatabaseId;
      query: string;
    };
    /**
     * undefined
     * @response `Database.executeSQL`
     */
    export type ExecuteSQLResponse = {
      columnNames?: string[] | undefined;
      values?: unknown[] | undefined;
      sqlError?: Error | undefined;
    };
    /**
     * undefined
     * @request `Database.getDatabaseTableNames`
     */
    export type GetDatabaseTableNamesRequest = {
      databaseId: DatabaseId;
    };
    /**
     * undefined
     * @response `Database.getDatabaseTableNames`
     */
    export type GetDatabaseTableNamesResponse = {
      tableNames: string[];
    };
  }
  export namespace DeviceAccess {
    /**
     * Device request id.
     */
    export type RequestId = string;
    /**
     * A device id.
     */
    export type DeviceId = string;
    /**
     * Device information displayed in a user prompt to select a device.
     */
    export type PromptDevice = {
      id: DeviceId;
      /**
       * Display name as it appears in a device request user prompt.
       */
      name: string;
    };
    /**
     * A device request opened a user prompt to select a device. Respond with the
     * selectPrompt or cancelPrompt command.
     * @event `DeviceAccess.deviceRequestPrompted`
     */
    export type DeviceRequestPromptedEvent = {
      id: RequestId;
      devices: PromptDevice[];
    };
    /**
     * Enable events in this domain.
     * @request `DeviceAccess.enable`
     */
    export type EnableRequest = {};
    /**
     * Enable events in this domain.
     * @response `DeviceAccess.enable`
     */
    export type EnableResponse = {};
    /**
     * Disable events in this domain.
     * @request `DeviceAccess.disable`
     */
    export type DisableRequest = {};
    /**
     * Disable events in this domain.
     * @response `DeviceAccess.disable`
     */
    export type DisableResponse = {};
    /**
     * Select a device in response to a DeviceAccess.deviceRequestPrompted event.
     * @request `DeviceAccess.selectPrompt`
     */
    export type SelectPromptRequest = {
      id: RequestId;
      deviceId: DeviceId;
    };
    /**
     * Select a device in response to a DeviceAccess.deviceRequestPrompted event.
     * @response `DeviceAccess.selectPrompt`
     */
    export type SelectPromptResponse = {};
    /**
     * Cancel a prompt in response to a DeviceAccess.deviceRequestPrompted event.
     * @request `DeviceAccess.cancelPrompt`
     */
    export type CancelPromptRequest = {
      id: RequestId;
    };
    /**
     * Cancel a prompt in response to a DeviceAccess.deviceRequestPrompted event.
     * @response `DeviceAccess.cancelPrompt`
     */
    export type CancelPromptResponse = {};
  }
  export namespace DeviceOrientation {
    /**
     * Clears the overridden Device Orientation.
     * @request `DeviceOrientation.clearDeviceOrientationOverride`
     */
    export type ClearDeviceOrientationOverrideRequest = {};
    /**
     * Clears the overridden Device Orientation.
     * @response `DeviceOrientation.clearDeviceOrientationOverride`
     */
    export type ClearDeviceOrientationOverrideResponse = {};
    /**
     * Overrides the Device Orientation.
     * @request `DeviceOrientation.setDeviceOrientationOverride`
     */
    export type SetDeviceOrientationOverrideRequest = {
      /**
       * Mock alpha
       */
      alpha: number;
      /**
       * Mock beta
       */
      beta: number;
      /**
       * Mock gamma
       */
      gamma: number;
    };
    /**
     * Overrides the Device Orientation.
     * @response `DeviceOrientation.setDeviceOrientationOverride`
     */
    export type SetDeviceOrientationOverrideResponse = {};
  }
  export namespace DOM {
    /**
     * Unique DOM node identifier.
     */
    export type NodeId = number;
    /**
     * Unique DOM node identifier used to reference a node that may not have been pushed to the
     * front-end.
     */
    export type BackendNodeId = number;
    /**
     * Backend node with a friendly name.
     */
    export type BackendNode = {
      /**
       * `Node`'s nodeType.
       */
      nodeType: number;
      /**
       * `Node`'s nodeName.
       */
      nodeName: string;
      backendNodeId: BackendNodeId;
    };
    /**
     * Pseudo element type.
     */
    export type PseudoType =
      | "first-line"
      | "first-letter"
      | "before"
      | "after"
      | "marker"
      | "backdrop"
      | "selection"
      | "target-text"
      | "spelling-error"
      | "grammar-error"
      | "highlight"
      | "first-line-inherited"
      | "scrollbar"
      | "scrollbar-thumb"
      | "scrollbar-button"
      | "scrollbar-track"
      | "scrollbar-track-piece"
      | "scrollbar-corner"
      | "resizer"
      | "input-list-button"
      | "view-transition"
      | "view-transition-group"
      | "view-transition-image-pair"
      | "view-transition-old"
      | "view-transition-new";
    /**
     * Shadow root type.
     */
    export type ShadowRootType = "user-agent" | "open" | "closed";
    /**
     * Document compatibility mode.
     */
    export type CompatibilityMode = "QuirksMode" | "LimitedQuirksMode" | "NoQuirksMode";
    /**
     * ContainerSelector physical axes
     */
    export type PhysicalAxes = "Horizontal" | "Vertical" | "Both";
    /**
     * ContainerSelector logical axes
     */
    export type LogicalAxes = "Inline" | "Block" | "Both";
    /**
     * DOM interaction is implemented in terms of mirror objects that represent the actual DOM nodes.
     * DOMNode is a base node mirror type.
     */
    export type Node = {
      /**
       * Node identifier that is passed into the rest of the DOM messages as the `nodeId`. Backend
       * will only push node with given `id` once. It is aware of all requested nodes and will only
       * fire DOM events for nodes known to the client.
       */
      nodeId: NodeId;
      /**
       * The id of the parent node if any.
       */
      parentId?: NodeId | undefined;
      /**
       * The BackendNodeId for this node.
       */
      backendNodeId: BackendNodeId;
      /**
       * `Node`'s nodeType.
       */
      nodeType: number;
      /**
       * `Node`'s nodeName.
       */
      nodeName: string;
      /**
       * `Node`'s localName.
       */
      localName: string;
      /**
       * `Node`'s nodeValue.
       */
      nodeValue: string;
      /**
       * Child count for `Container` nodes.
       */
      childNodeCount?: number | undefined;
      /**
       * Child nodes of this node when requested with children.
       */
      children?: Node[] | undefined;
      /**
       * Attributes of the `Element` node in the form of flat array `[name1, value1, name2, value2]`.
       */
      attributes?: string[] | undefined;
      /**
       * Document URL that `Document` or `FrameOwner` node points to.
       */
      documentURL?: string | undefined;
      /**
       * Base URL that `Document` or `FrameOwner` node uses for URL completion.
       */
      baseURL?: string | undefined;
      /**
       * `DocumentType`'s publicId.
       */
      publicId?: string | undefined;
      /**
       * `DocumentType`'s systemId.
       */
      systemId?: string | undefined;
      /**
       * `DocumentType`'s internalSubset.
       */
      internalSubset?: string | undefined;
      /**
       * `Document`'s XML version in case of XML documents.
       */
      xmlVersion?: string | undefined;
      /**
       * `Attr`'s name.
       */
      name?: string | undefined;
      /**
       * `Attr`'s value.
       */
      value?: string | undefined;
      /**
       * Pseudo element type for this node.
       */
      pseudoType?: PseudoType | undefined;
      /**
       * Pseudo element identifier for this node. Only present if there is a
       * valid pseudoType.
       */
      pseudoIdentifier?: string | undefined;
      /**
       * Shadow root type.
       */
      shadowRootType?: ShadowRootType | undefined;
      /**
       * Frame ID for frame owner elements.
       */
      frameId?: Page.FrameId | undefined;
      /**
       * Content document for frame owner elements.
       */
      contentDocument?: Node | undefined;
      /**
       * Shadow root list for given element host.
       */
      shadowRoots?: Node[] | undefined;
      /**
       * Content document fragment for template elements.
       */
      templateContent?: Node | undefined;
      /**
       * Pseudo elements associated with this node.
       */
      pseudoElements?: Node[] | undefined;
      /**
       * Deprecated, as the HTML Imports API has been removed (crbug.com/937746).
       * This property used to return the imported document for the HTMLImport links.
       * The property is always undefined now.
       */
      importedDocument?: Node | undefined;
      /**
       * Distributed nodes for given insertion point.
       */
      distributedNodes?: BackendNode[] | undefined;
      /**
       * Whether the node is SVG.
       */
      isSVG?: boolean | undefined;
      compatibilityMode?: CompatibilityMode | undefined;
      assignedSlot?: BackendNode | undefined;
    };
    /**
     * A structure holding an RGBA color.
     */
    export type RGBA = {
      /**
       * The red component, in the [0-255] range.
       */
      r: number;
      /**
       * The green component, in the [0-255] range.
       */
      g: number;
      /**
       * The blue component, in the [0-255] range.
       */
      b: number;
      /**
       * The alpha component, in the [0-1] range (default: 1).
       */
      a?: number | undefined;
    };
    /**
     * An array of quad vertices, x immediately followed by y for each point, points clock-wise.
     */
    export type Quad = number[];
    /**
     * Box model.
     */
    export type BoxModel = {
      /**
       * Content box
       */
      content: Quad;
      /**
       * Padding box
       */
      padding: Quad;
      /**
       * Border box
       */
      border: Quad;
      /**
       * Margin box
       */
      margin: Quad;
      /**
       * Node width
       */
      width: number;
      /**
       * Node height
       */
      height: number;
      /**
       * Shape outside coordinates
       */
      shapeOutside?: ShapeOutsideInfo | undefined;
    };
    /**
     * CSS Shape Outside details.
     */
    export type ShapeOutsideInfo = {
      /**
       * Shape bounds
       */
      bounds: Quad;
      /**
       * Shape coordinate details
       */
      shape: unknown[];
      /**
       * Margin shape bounds
       */
      marginShape: unknown[];
    };
    /**
     * Rectangle.
     */
    export type Rect = {
      /**
       * X coordinate
       */
      x: number;
      /**
       * Y coordinate
       */
      y: number;
      /**
       * Rectangle width
       */
      width: number;
      /**
       * Rectangle height
       */
      height: number;
    };
    export type CSSComputedStyleProperty = {
      /**
       * Computed style property name.
       */
      name: string;
      /**
       * Computed style property value.
       */
      value: string;
    };
    /**
     * Fired when `Element`'s attribute is modified.
     * @event `DOM.attributeModified`
     */
    export type AttributeModifiedEvent = {
      /**
       * Id of the node that has changed.
       */
      nodeId: NodeId;
      /**
       * Attribute name.
       */
      name: string;
      /**
       * Attribute value.
       */
      value: string;
    };
    /**
     * Fired when `Element`'s attribute is removed.
     * @event `DOM.attributeRemoved`
     */
    export type AttributeRemovedEvent = {
      /**
       * Id of the node that has changed.
       */
      nodeId: NodeId;
      /**
       * A ttribute name.
       */
      name: string;
    };
    /**
     * Mirrors `DOMCharacterDataModified` event.
     * @event `DOM.characterDataModified`
     */
    export type CharacterDataModifiedEvent = {
      /**
       * Id of the node that has changed.
       */
      nodeId: NodeId;
      /**
       * New text value.
       */
      characterData: string;
    };
    /**
     * Fired when `Container`'s child node count has changed.
     * @event `DOM.childNodeCountUpdated`
     */
    export type ChildNodeCountUpdatedEvent = {
      /**
       * Id of the node that has changed.
       */
      nodeId: NodeId;
      /**
       * New node count.
       */
      childNodeCount: number;
    };
    /**
     * Mirrors `DOMNodeInserted` event.
     * @event `DOM.childNodeInserted`
     */
    export type ChildNodeInsertedEvent = {
      /**
       * Id of the node that has changed.
       */
      parentNodeId: NodeId;
      /**
       * Id of the previous sibling.
       */
      previousNodeId: NodeId;
      /**
       * Inserted node data.
       */
      node: Node;
    };
    /**
     * Mirrors `DOMNodeRemoved` event.
     * @event `DOM.childNodeRemoved`
     */
    export type ChildNodeRemovedEvent = {
      /**
       * Parent id.
       */
      parentNodeId: NodeId;
      /**
       * Id of the node that has been removed.
       */
      nodeId: NodeId;
    };
    /**
     * Called when distribution is changed.
     * @event `DOM.distributedNodesUpdated`
     */
    export type DistributedNodesUpdatedEvent = {
      /**
       * Insertion point where distributed nodes were updated.
       */
      insertionPointId: NodeId;
      /**
       * Distributed nodes for given insertion point.
       */
      distributedNodes: BackendNode[];
    };
    /**
     * Fired when `Document` has been totally updated. Node ids are no longer valid.
     * @event `DOM.documentUpdated`
     */
    export type DocumentUpdatedEvent = {};
    /**
     * Fired when `Element`'s inline style is modified via a CSS property modification.
     * @event `DOM.inlineStyleInvalidated`
     */
    export type InlineStyleInvalidatedEvent = {
      /**
       * Ids of the nodes for which the inline styles have been invalidated.
       */
      nodeIds: NodeId[];
    };
    /**
     * Called when a pseudo element is added to an element.
     * @event `DOM.pseudoElementAdded`
     */
    export type PseudoElementAddedEvent = {
      /**
       * Pseudo element's parent element id.
       */
      parentId: NodeId;
      /**
       * The added pseudo element.
       */
      pseudoElement: Node;
    };
    /**
     * Called when top layer elements are changed.
     * @event `DOM.topLayerElementsUpdated`
     */
    export type TopLayerElementsUpdatedEvent = {};
    /**
     * Called when a pseudo element is removed from an element.
     * @event `DOM.pseudoElementRemoved`
     */
    export type PseudoElementRemovedEvent = {
      /**
       * Pseudo element's parent element id.
       */
      parentId: NodeId;
      /**
       * The removed pseudo element id.
       */
      pseudoElementId: NodeId;
    };
    /**
     * Fired when backend wants to provide client with the missing DOM structure. This happens upon
     * most of the calls requesting node ids.
     * @event `DOM.setChildNodes`
     */
    export type SetChildNodesEvent = {
      /**
       * Parent node id to populate with children.
       */
      parentId: NodeId;
      /**
       * Child nodes array.
       */
      nodes: Node[];
    };
    /**
     * Called when shadow root is popped from the element.
     * @event `DOM.shadowRootPopped`
     */
    export type ShadowRootPoppedEvent = {
      /**
       * Host element id.
       */
      hostId: NodeId;
      /**
       * Shadow root id.
       */
      rootId: NodeId;
    };
    /**
     * Called when shadow root is pushed into the element.
     * @event `DOM.shadowRootPushed`
     */
    export type ShadowRootPushedEvent = {
      /**
       * Host element id.
       */
      hostId: NodeId;
      /**
       * Shadow root.
       */
      root: Node;
    };
    /**
     * Collects class names for the node with given id and all of it's child nodes.
     * @request `DOM.collectClassNamesFromSubtree`
     */
    export type CollectClassNamesFromSubtreeRequest = {
      /**
       * Id of the node to collect class names.
       */
      nodeId: NodeId;
    };
    /**
     * Collects class names for the node with given id and all of it's child nodes.
     * @response `DOM.collectClassNamesFromSubtree`
     */
    export type CollectClassNamesFromSubtreeResponse = {
      /**
       * Class name list.
       */
      classNames: string[];
    };
    /**
     * Creates a deep copy of the specified node and places it into the target container before the
     * given anchor.
     * @request `DOM.copyTo`
     */
    export type CopyToRequest = {
      /**
       * Id of the node to copy.
       */
      nodeId: NodeId;
      /**
       * Id of the element to drop the copy into.
       */
      targetNodeId: NodeId;
      /**
       * Drop the copy before this node (if absent, the copy becomes the last child of
       * `targetNodeId`).
       */
      insertBeforeNodeId?: NodeId | undefined;
    };
    /**
     * Creates a deep copy of the specified node and places it into the target container before the
     * given anchor.
     * @response `DOM.copyTo`
     */
    export type CopyToResponse = {
      /**
       * Id of the node clone.
       */
      nodeId: NodeId;
    };
    /**
     * Describes node given its id, does not require domain to be enabled. Does not start tracking any
     * objects, can be used for automation.
     * @request `DOM.describeNode`
     */
    export type DescribeNodeRequest = {
      /**
       * Identifier of the node.
       */
      nodeId?: NodeId | undefined;
      /**
       * Identifier of the backend node.
       */
      backendNodeId?: BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
      /**
       * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the
       * entire subtree or provide an integer larger than 0.
       */
      depth?: number | undefined;
      /**
       * Whether or not iframes and shadow roots should be traversed when returning the subtree
       * (default is false).
       */
      pierce?: boolean | undefined;
    };
    /**
     * Describes node given its id, does not require domain to be enabled. Does not start tracking any
     * objects, can be used for automation.
     * @response `DOM.describeNode`
     */
    export type DescribeNodeResponse = {
      /**
       * Node description.
       */
      node: Node;
    };
    /**
     * Scrolls the specified rect of the given node into view if not already visible.
     * Note: exactly one between nodeId, backendNodeId and objectId should be passed
     * to identify the node.
     * @request `DOM.scrollIntoViewIfNeeded`
     */
    export type ScrollIntoViewIfNeededRequest = {
      /**
       * Identifier of the node.
       */
      nodeId?: NodeId | undefined;
      /**
       * Identifier of the backend node.
       */
      backendNodeId?: BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
      /**
       * The rect to be scrolled into view, relative to the node's border box, in CSS pixels.
       * When omitted, center of the node will be used, similar to Element.scrollIntoView.
       */
      rect?: Rect | undefined;
    };
    /**
     * Scrolls the specified rect of the given node into view if not already visible.
     * Note: exactly one between nodeId, backendNodeId and objectId should be passed
     * to identify the node.
     * @response `DOM.scrollIntoViewIfNeeded`
     */
    export type ScrollIntoViewIfNeededResponse = {};
    /**
     * Disables DOM agent for the given page.
     * @request `DOM.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables DOM agent for the given page.
     * @response `DOM.disable`
     */
    export type DisableResponse = {};
    /**
     * Discards search results from the session with the given id. `getSearchResults` should no longer
     * be called for that search.
     * @request `DOM.discardSearchResults`
     */
    export type DiscardSearchResultsRequest = {
      /**
       * Unique search session identifier.
       */
      searchId: string;
    };
    /**
     * Discards search results from the session with the given id. `getSearchResults` should no longer
     * be called for that search.
     * @response `DOM.discardSearchResults`
     */
    export type DiscardSearchResultsResponse = {};
    /**
     * Enables DOM agent for the given page.
     * @request `DOM.enable`
     */
    export type EnableRequest = {
      /**
       * Whether to include whitespaces in the children array of returned Nodes.
       */
      includeWhitespace?: "none" | "all" | undefined;
    };
    /**
     * Enables DOM agent for the given page.
     * @response `DOM.enable`
     */
    export type EnableResponse = {};
    /**
     * Focuses the given element.
     * @request `DOM.focus`
     */
    export type FocusRequest = {
      /**
       * Identifier of the node.
       */
      nodeId?: NodeId | undefined;
      /**
       * Identifier of the backend node.
       */
      backendNodeId?: BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
    };
    /**
     * Focuses the given element.
     * @response `DOM.focus`
     */
    export type FocusResponse = {};
    /**
     * Returns attributes for the specified node.
     * @request `DOM.getAttributes`
     */
    export type GetAttributesRequest = {
      /**
       * Id of the node to retrieve attibutes for.
       */
      nodeId: NodeId;
    };
    /**
     * Returns attributes for the specified node.
     * @response `DOM.getAttributes`
     */
    export type GetAttributesResponse = {
      /**
       * An interleaved array of node attribute names and values.
       */
      attributes: string[];
    };
    /**
     * Returns boxes for the given node.
     * @request `DOM.getBoxModel`
     */
    export type GetBoxModelRequest = {
      /**
       * Identifier of the node.
       */
      nodeId?: NodeId | undefined;
      /**
       * Identifier of the backend node.
       */
      backendNodeId?: BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
    };
    /**
     * Returns boxes for the given node.
     * @response `DOM.getBoxModel`
     */
    export type GetBoxModelResponse = {
      /**
       * Box model for the node.
       */
      model: BoxModel;
    };
    /**
     * Returns quads that describe node position on the page. This method
     * might return multiple quads for inline nodes.
     * @request `DOM.getContentQuads`
     */
    export type GetContentQuadsRequest = {
      /**
       * Identifier of the node.
       */
      nodeId?: NodeId | undefined;
      /**
       * Identifier of the backend node.
       */
      backendNodeId?: BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
    };
    /**
     * Returns quads that describe node position on the page. This method
     * might return multiple quads for inline nodes.
     * @response `DOM.getContentQuads`
     */
    export type GetContentQuadsResponse = {
      /**
       * Quads that describe node layout relative to viewport.
       */
      quads: Quad[];
    };
    /**
     * Returns the root DOM node (and optionally the subtree) to the caller.
     * Implicitly enables the DOM domain events for the current target.
     * @request `DOM.getDocument`
     */
    export type GetDocumentRequest = {
      /**
       * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the
       * entire subtree or provide an integer larger than 0.
       */
      depth?: number | undefined;
      /**
       * Whether or not iframes and shadow roots should be traversed when returning the subtree
       * (default is false).
       */
      pierce?: boolean | undefined;
    };
    /**
     * Returns the root DOM node (and optionally the subtree) to the caller.
     * Implicitly enables the DOM domain events for the current target.
     * @response `DOM.getDocument`
     */
    export type GetDocumentResponse = {
      /**
       * Resulting node.
       */
      root: Node;
    };
    /**
     * Returns the root DOM node (and optionally the subtree) to the caller.
     * Deprecated, as it is not designed to work well with the rest of the DOM agent.
     * Use DOMSnapshot.captureSnapshot instead.
     * @request `DOM.getFlattenedDocument`
     */
    export type GetFlattenedDocumentRequest = {
      /**
       * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the
       * entire subtree or provide an integer larger than 0.
       */
      depth?: number | undefined;
      /**
       * Whether or not iframes and shadow roots should be traversed when returning the subtree
       * (default is false).
       */
      pierce?: boolean | undefined;
    };
    /**
     * Returns the root DOM node (and optionally the subtree) to the caller.
     * Deprecated, as it is not designed to work well with the rest of the DOM agent.
     * Use DOMSnapshot.captureSnapshot instead.
     * @response `DOM.getFlattenedDocument`
     */
    export type GetFlattenedDocumentResponse = {
      /**
       * Resulting node.
       */
      nodes: Node[];
    };
    /**
     * Finds nodes with a given computed style in a subtree.
     * @request `DOM.getNodesForSubtreeByStyle`
     */
    export type GetNodesForSubtreeByStyleRequest = {
      /**
       * Node ID pointing to the root of a subtree.
       */
      nodeId: NodeId;
      /**
       * The style to filter nodes by (includes nodes if any of properties matches).
       */
      computedStyles: CSSComputedStyleProperty[];
      /**
       * Whether or not iframes and shadow roots in the same target should be traversed when returning the
       * results (default is false).
       */
      pierce?: boolean | undefined;
    };
    /**
     * Finds nodes with a given computed style in a subtree.
     * @response `DOM.getNodesForSubtreeByStyle`
     */
    export type GetNodesForSubtreeByStyleResponse = {
      /**
       * Resulting nodes.
       */
      nodeIds: NodeId[];
    };
    /**
     * Returns node id at given location. Depending on whether DOM domain is enabled, nodeId is
     * either returned or not.
     * @request `DOM.getNodeForLocation`
     */
    export type GetNodeForLocationRequest = {
      /**
       * X coordinate.
       */
      x: number;
      /**
       * Y coordinate.
       */
      y: number;
      /**
       * False to skip to the nearest non-UA shadow root ancestor (default: false).
       */
      includeUserAgentShadowDOM?: boolean | undefined;
      /**
       * Whether to ignore pointer-events: none on elements and hit test them.
       */
      ignorePointerEventsNone?: boolean | undefined;
    };
    /**
     * Returns node id at given location. Depending on whether DOM domain is enabled, nodeId is
     * either returned or not.
     * @response `DOM.getNodeForLocation`
     */
    export type GetNodeForLocationResponse = {
      /**
       * Resulting node.
       */
      backendNodeId: BackendNodeId;
      /**
       * Frame this node belongs to.
       */
      frameId: Page.FrameId;
      /**
       * Id of the node at given coordinates, only when enabled and requested document.
       */
      nodeId?: NodeId | undefined;
    };
    /**
     * Returns node's HTML markup.
     * @request `DOM.getOuterHTML`
     */
    export type GetOuterHTMLRequest = {
      /**
       * Identifier of the node.
       */
      nodeId?: NodeId | undefined;
      /**
       * Identifier of the backend node.
       */
      backendNodeId?: BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
    };
    /**
     * Returns node's HTML markup.
     * @response `DOM.getOuterHTML`
     */
    export type GetOuterHTMLResponse = {
      /**
       * Outer HTML markup.
       */
      outerHTML: string;
    };
    /**
     * Returns the id of the nearest ancestor that is a relayout boundary.
     * @request `DOM.getRelayoutBoundary`
     */
    export type GetRelayoutBoundaryRequest = {
      /**
       * Id of the node.
       */
      nodeId: NodeId;
    };
    /**
     * Returns the id of the nearest ancestor that is a relayout boundary.
     * @response `DOM.getRelayoutBoundary`
     */
    export type GetRelayoutBoundaryResponse = {
      /**
       * Relayout boundary node id for the given node.
       */
      nodeId: NodeId;
    };
    /**
     * Returns search results from given `fromIndex` to given `toIndex` from the search with the given
     * identifier.
     * @request `DOM.getSearchResults`
     */
    export type GetSearchResultsRequest = {
      /**
       * Unique search session identifier.
       */
      searchId: string;
      /**
       * Start index of the search result to be returned.
       */
      fromIndex: number;
      /**
       * End index of the search result to be returned.
       */
      toIndex: number;
    };
    /**
     * Returns search results from given `fromIndex` to given `toIndex` from the search with the given
     * identifier.
     * @response `DOM.getSearchResults`
     */
    export type GetSearchResultsResponse = {
      /**
       * Ids of the search result nodes.
       */
      nodeIds: NodeId[];
    };
    /**
     * Hides any highlight.
     * @request `DOM.hideHighlight`
     */
    export type HideHighlightRequest = {};
    /**
     * Hides any highlight.
     * @response `DOM.hideHighlight`
     */
    export type HideHighlightResponse = {};
    /**
     * Highlights DOM node.
     * @request `DOM.highlightNode`
     */
    export type HighlightNodeRequest = {};
    /**
     * Highlights DOM node.
     * @response `DOM.highlightNode`
     */
    export type HighlightNodeResponse = {};
    /**
     * Highlights given rectangle.
     * @request `DOM.highlightRect`
     */
    export type HighlightRectRequest = {};
    /**
     * Highlights given rectangle.
     * @response `DOM.highlightRect`
     */
    export type HighlightRectResponse = {};
    /**
     * Marks last undoable state.
     * @request `DOM.markUndoableState`
     */
    export type MarkUndoableStateRequest = {};
    /**
     * Marks last undoable state.
     * @response `DOM.markUndoableState`
     */
    export type MarkUndoableStateResponse = {};
    /**
     * Moves node into the new container, places it before the given anchor.
     * @request `DOM.moveTo`
     */
    export type MoveToRequest = {
      /**
       * Id of the node to move.
       */
      nodeId: NodeId;
      /**
       * Id of the element to drop the moved node into.
       */
      targetNodeId: NodeId;
      /**
       * Drop node before this one (if absent, the moved node becomes the last child of
       * `targetNodeId`).
       */
      insertBeforeNodeId?: NodeId | undefined;
    };
    /**
     * Moves node into the new container, places it before the given anchor.
     * @response `DOM.moveTo`
     */
    export type MoveToResponse = {
      /**
       * New id of the moved node.
       */
      nodeId: NodeId;
    };
    /**
     * Searches for a given string in the DOM tree. Use `getSearchResults` to access search results or
     * `cancelSearch` to end this search session.
     * @request `DOM.performSearch`
     */
    export type PerformSearchRequest = {
      /**
       * Plain text or query selector or XPath search query.
       */
      query: string;
      /**
       * True to search in user agent shadow DOM.
       */
      includeUserAgentShadowDOM?: boolean | undefined;
    };
    /**
     * Searches for a given string in the DOM tree. Use `getSearchResults` to access search results or
     * `cancelSearch` to end this search session.
     * @response `DOM.performSearch`
     */
    export type PerformSearchResponse = {
      /**
       * Unique search session identifier.
       */
      searchId: string;
      /**
       * Number of search results.
       */
      resultCount: number;
    };
    /**
     * Requests that the node is sent to the caller given its path. // FIXME, use XPath
     * @request `DOM.pushNodeByPathToFrontend`
     */
    export type PushNodeByPathToFrontendRequest = {
      /**
       * Path to node in the proprietary format.
       */
      path: string;
    };
    /**
     * Requests that the node is sent to the caller given its path. // FIXME, use XPath
     * @response `DOM.pushNodeByPathToFrontend`
     */
    export type PushNodeByPathToFrontendResponse = {
      /**
       * Id of the node for given path.
       */
      nodeId: NodeId;
    };
    /**
     * Requests that a batch of nodes is sent to the caller given their backend node ids.
     * @request `DOM.pushNodesByBackendIdsToFrontend`
     */
    export type PushNodesByBackendIdsToFrontendRequest = {
      /**
       * The array of backend node ids.
       */
      backendNodeIds: BackendNodeId[];
    };
    /**
     * Requests that a batch of nodes is sent to the caller given their backend node ids.
     * @response `DOM.pushNodesByBackendIdsToFrontend`
     */
    export type PushNodesByBackendIdsToFrontendResponse = {
      /**
       * The array of ids of pushed nodes that correspond to the backend ids specified in
       * backendNodeIds.
       */
      nodeIds: NodeId[];
    };
    /**
     * Executes `querySelector` on a given node.
     * @request `DOM.querySelector`
     */
    export type QuerySelectorRequest = {
      /**
       * Id of the node to query upon.
       */
      nodeId: NodeId;
      /**
       * Selector string.
       */
      selector: string;
    };
    /**
     * Executes `querySelector` on a given node.
     * @response `DOM.querySelector`
     */
    export type QuerySelectorResponse = {
      /**
       * Query selector result.
       */
      nodeId: NodeId;
    };
    /**
     * Executes `querySelectorAll` on a given node.
     * @request `DOM.querySelectorAll`
     */
    export type QuerySelectorAllRequest = {
      /**
       * Id of the node to query upon.
       */
      nodeId: NodeId;
      /**
       * Selector string.
       */
      selector: string;
    };
    /**
     * Executes `querySelectorAll` on a given node.
     * @response `DOM.querySelectorAll`
     */
    export type QuerySelectorAllResponse = {
      /**
       * Query selector result.
       */
      nodeIds: NodeId[];
    };
    /**
     * Returns NodeIds of current top layer elements.
     * Top layer is rendered closest to the user within a viewport, therefore its elements always
     * appear on top of all other content.
     * @request `DOM.getTopLayerElements`
     */
    export type GetTopLayerElementsRequest = {};
    /**
     * Returns NodeIds of current top layer elements.
     * Top layer is rendered closest to the user within a viewport, therefore its elements always
     * appear on top of all other content.
     * @response `DOM.getTopLayerElements`
     */
    export type GetTopLayerElementsResponse = {
      /**
       * NodeIds of top layer elements
       */
      nodeIds: NodeId[];
    };
    /**
     * Re-does the last undone action.
     * @request `DOM.redo`
     */
    export type RedoRequest = {};
    /**
     * Re-does the last undone action.
     * @response `DOM.redo`
     */
    export type RedoResponse = {};
    /**
     * Removes attribute with given name from an element with given id.
     * @request `DOM.removeAttribute`
     */
    export type RemoveAttributeRequest = {
      /**
       * Id of the element to remove attribute from.
       */
      nodeId: NodeId;
      /**
       * Name of the attribute to remove.
       */
      name: string;
    };
    /**
     * Removes attribute with given name from an element with given id.
     * @response `DOM.removeAttribute`
     */
    export type RemoveAttributeResponse = {};
    /**
     * Removes node with given id.
     * @request `DOM.removeNode`
     */
    export type RemoveNodeRequest = {
      /**
       * Id of the node to remove.
       */
      nodeId: NodeId;
    };
    /**
     * Removes node with given id.
     * @response `DOM.removeNode`
     */
    export type RemoveNodeResponse = {};
    /**
     * Requests that children of the node with given id are returned to the caller in form of
     * `setChildNodes` events where not only immediate children are retrieved, but all children down to
     * the specified depth.
     * @request `DOM.requestChildNodes`
     */
    export type RequestChildNodesRequest = {
      /**
       * Id of the node to get children for.
       */
      nodeId: NodeId;
      /**
       * The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the
       * entire subtree or provide an integer larger than 0.
       */
      depth?: number | undefined;
      /**
       * Whether or not iframes and shadow roots should be traversed when returning the sub-tree
       * (default is false).
       */
      pierce?: boolean | undefined;
    };
    /**
     * Requests that children of the node with given id are returned to the caller in form of
     * `setChildNodes` events where not only immediate children are retrieved, but all children down to
     * the specified depth.
     * @response `DOM.requestChildNodes`
     */
    export type RequestChildNodesResponse = {};
    /**
     * Requests that the node is sent to the caller given the JavaScript node object reference. All
     * nodes that form the path from the node to the root are also sent to the client as a series of
     * `setChildNodes` notifications.
     * @request `DOM.requestNode`
     */
    export type RequestNodeRequest = {
      /**
       * JavaScript object id to convert into node.
       */
      objectId: Runtime.RemoteObjectId;
    };
    /**
     * Requests that the node is sent to the caller given the JavaScript node object reference. All
     * nodes that form the path from the node to the root are also sent to the client as a series of
     * `setChildNodes` notifications.
     * @response `DOM.requestNode`
     */
    export type RequestNodeResponse = {
      /**
       * Node id for given object.
       */
      nodeId: NodeId;
    };
    /**
     * Resolves the JavaScript node object for a given NodeId or BackendNodeId.
     * @request `DOM.resolveNode`
     */
    export type ResolveNodeRequest = {
      /**
       * Id of the node to resolve.
       */
      nodeId?: NodeId | undefined;
      /**
       * Backend identifier of the node to resolve.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * Symbolic group name that can be used to release multiple objects.
       */
      objectGroup?: string | undefined;
      /**
       * Execution context in which to resolve the node.
       */
      executionContextId?: Runtime.ExecutionContextId | undefined;
    };
    /**
     * Resolves the JavaScript node object for a given NodeId or BackendNodeId.
     * @response `DOM.resolveNode`
     */
    export type ResolveNodeResponse = {
      /**
       * JavaScript object wrapper for given node.
       */
      object: Runtime.RemoteObject;
    };
    /**
     * Sets attribute for an element with given id.
     * @request `DOM.setAttributeValue`
     */
    export type SetAttributeValueRequest = {
      /**
       * Id of the element to set attribute for.
       */
      nodeId: NodeId;
      /**
       * Attribute name.
       */
      name: string;
      /**
       * Attribute value.
       */
      value: string;
    };
    /**
     * Sets attribute for an element with given id.
     * @response `DOM.setAttributeValue`
     */
    export type SetAttributeValueResponse = {};
    /**
     * Sets attributes on element with given id. This method is useful when user edits some existing
     * attribute value and types in several attribute name/value pairs.
     * @request `DOM.setAttributesAsText`
     */
    export type SetAttributesAsTextRequest = {
      /**
       * Id of the element to set attributes for.
       */
      nodeId: NodeId;
      /**
       * Text with a number of attributes. Will parse this text using HTML parser.
       */
      text: string;
      /**
       * Attribute name to replace with new attributes derived from text in case text parsed
       * successfully.
       */
      name?: string | undefined;
    };
    /**
     * Sets attributes on element with given id. This method is useful when user edits some existing
     * attribute value and types in several attribute name/value pairs.
     * @response `DOM.setAttributesAsText`
     */
    export type SetAttributesAsTextResponse = {};
    /**
     * Sets files for the given file input element.
     * @request `DOM.setFileInputFiles`
     */
    export type SetFileInputFilesRequest = {
      /**
       * Array of file paths to set.
       */
      files: string[];
      /**
       * Identifier of the node.
       */
      nodeId?: NodeId | undefined;
      /**
       * Identifier of the backend node.
       */
      backendNodeId?: BackendNodeId | undefined;
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
    };
    /**
     * Sets files for the given file input element.
     * @response `DOM.setFileInputFiles`
     */
    export type SetFileInputFilesResponse = {};
    /**
     * Sets if stack traces should be captured for Nodes. See `Node.getNodeStackTraces`. Default is disabled.
     * @request `DOM.setNodeStackTracesEnabled`
     */
    export type SetNodeStackTracesEnabledRequest = {
      /**
       * Enable or disable.
       */
      enable: boolean;
    };
    /**
     * Sets if stack traces should be captured for Nodes. See `Node.getNodeStackTraces`. Default is disabled.
     * @response `DOM.setNodeStackTracesEnabled`
     */
    export type SetNodeStackTracesEnabledResponse = {};
    /**
     * Gets stack traces associated with a Node. As of now, only provides stack trace for Node creation.
     * @request `DOM.getNodeStackTraces`
     */
    export type GetNodeStackTracesRequest = {
      /**
       * Id of the node to get stack traces for.
       */
      nodeId: NodeId;
    };
    /**
     * Gets stack traces associated with a Node. As of now, only provides stack trace for Node creation.
     * @response `DOM.getNodeStackTraces`
     */
    export type GetNodeStackTracesResponse = {
      /**
       * Creation stack trace, if available.
       */
      creation?: Runtime.StackTrace | undefined;
    };
    /**
     * Returns file information for the given
     * File wrapper.
     * @request `DOM.getFileInfo`
     */
    export type GetFileInfoRequest = {
      /**
       * JavaScript object id of the node wrapper.
       */
      objectId: Runtime.RemoteObjectId;
    };
    /**
     * Returns file information for the given
     * File wrapper.
     * @response `DOM.getFileInfo`
     */
    export type GetFileInfoResponse = {
      path: string;
    };
    /**
     * Enables console to refer to the node with given id via $x (see Command Line API for more details
     * $x functions).
     * @request `DOM.setInspectedNode`
     */
    export type SetInspectedNodeRequest = {
      /**
       * DOM node id to be accessible by means of $x command line API.
       */
      nodeId: NodeId;
    };
    /**
     * Enables console to refer to the node with given id via $x (see Command Line API for more details
     * $x functions).
     * @response `DOM.setInspectedNode`
     */
    export type SetInspectedNodeResponse = {};
    /**
     * Sets node name for a node with given id.
     * @request `DOM.setNodeName`
     */
    export type SetNodeNameRequest = {
      /**
       * Id of the node to set name for.
       */
      nodeId: NodeId;
      /**
       * New node's name.
       */
      name: string;
    };
    /**
     * Sets node name for a node with given id.
     * @response `DOM.setNodeName`
     */
    export type SetNodeNameResponse = {
      /**
       * New node's id.
       */
      nodeId: NodeId;
    };
    /**
     * Sets node value for a node with given id.
     * @request `DOM.setNodeValue`
     */
    export type SetNodeValueRequest = {
      /**
       * Id of the node to set value for.
       */
      nodeId: NodeId;
      /**
       * New node's value.
       */
      value: string;
    };
    /**
     * Sets node value for a node with given id.
     * @response `DOM.setNodeValue`
     */
    export type SetNodeValueResponse = {};
    /**
     * Sets node HTML markup, returns new node id.
     * @request `DOM.setOuterHTML`
     */
    export type SetOuterHTMLRequest = {
      /**
       * Id of the node to set markup for.
       */
      nodeId: NodeId;
      /**
       * Outer HTML markup to set.
       */
      outerHTML: string;
    };
    /**
     * Sets node HTML markup, returns new node id.
     * @response `DOM.setOuterHTML`
     */
    export type SetOuterHTMLResponse = {};
    /**
     * Undoes the last performed action.
     * @request `DOM.undo`
     */
    export type UndoRequest = {};
    /**
     * Undoes the last performed action.
     * @response `DOM.undo`
     */
    export type UndoResponse = {};
    /**
     * Returns iframe node that owns iframe with the given domain.
     * @request `DOM.getFrameOwner`
     */
    export type GetFrameOwnerRequest = {
      frameId: Page.FrameId;
    };
    /**
     * Returns iframe node that owns iframe with the given domain.
     * @response `DOM.getFrameOwner`
     */
    export type GetFrameOwnerResponse = {
      /**
       * Resulting node.
       */
      backendNodeId: BackendNodeId;
      /**
       * Id of the node at given coordinates, only when enabled and requested document.
       */
      nodeId?: NodeId | undefined;
    };
    /**
     * Returns the query container of the given node based on container query
     * conditions: containerName, physical, and logical axes. If no axes are
     * provided, the style container is returned, which is the direct parent or the
     * closest element with a matching container-name.
     * @request `DOM.getContainerForNode`
     */
    export type GetContainerForNodeRequest = {
      nodeId: NodeId;
      containerName?: string | undefined;
      physicalAxes?: PhysicalAxes | undefined;
      logicalAxes?: LogicalAxes | undefined;
    };
    /**
     * Returns the query container of the given node based on container query
     * conditions: containerName, physical, and logical axes. If no axes are
     * provided, the style container is returned, which is the direct parent or the
     * closest element with a matching container-name.
     * @response `DOM.getContainerForNode`
     */
    export type GetContainerForNodeResponse = {
      /**
       * The container node for the given node, or null if not found.
       */
      nodeId?: NodeId | undefined;
    };
    /**
     * Returns the descendants of a container query container that have
     * container queries against this container.
     * @request `DOM.getQueryingDescendantsForContainer`
     */
    export type GetQueryingDescendantsForContainerRequest = {
      /**
       * Id of the container node to find querying descendants from.
       */
      nodeId: NodeId;
    };
    /**
     * Returns the descendants of a container query container that have
     * container queries against this container.
     * @response `DOM.getQueryingDescendantsForContainer`
     */
    export type GetQueryingDescendantsForContainerResponse = {
      /**
       * Descendant nodes with container queries against the given container.
       */
      nodeIds: NodeId[];
    };
  }
  export namespace DOMDebugger {
    /**
     * DOM breakpoint type.
     */
    export type DOMBreakpointType = "subtree-modified" | "attribute-modified" | "node-removed";
    /**
     * CSP Violation type.
     */
    export type CSPViolationType = "trustedtype-sink-violation" | "trustedtype-policy-violation";
    /**
     * Object event listener.
     */
    export type EventListener = {
      /**
       * `EventListener`'s type.
       */
      type: string;
      /**
       * `EventListener`'s useCapture.
       */
      useCapture: boolean;
      /**
       * `EventListener`'s passive flag.
       */
      passive: boolean;
      /**
       * `EventListener`'s once flag.
       */
      once: boolean;
      /**
       * Script id of the handler code.
       */
      scriptId: Runtime.ScriptId;
      /**
       * Line number in the script (0-based).
       */
      lineNumber: number;
      /**
       * Column number in the script (0-based).
       */
      columnNumber: number;
      /**
       * Event handler function value.
       */
      handler?: Runtime.RemoteObject | undefined;
      /**
       * Event original handler function value.
       */
      originalHandler?: Runtime.RemoteObject | undefined;
      /**
       * Node the listener is added to (if any).
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
    };
    /**
     * Returns event listeners of the given object.
     * @request `DOMDebugger.getEventListeners`
     */
    export type GetEventListenersRequest = {
      /**
       * Identifier of the object to return listeners for.
       */
      objectId: Runtime.RemoteObjectId;
      /**
       * The maximum depth at which Node children should be retrieved, defaults to 1. Use -1 for the
       * entire subtree or provide an integer larger than 0.
       */
      depth?: number | undefined;
      /**
       * Whether or not iframes and shadow roots should be traversed when returning the subtree
       * (default is false). Reports listeners for all contexts if pierce is enabled.
       */
      pierce?: boolean | undefined;
    };
    /**
     * Returns event listeners of the given object.
     * @response `DOMDebugger.getEventListeners`
     */
    export type GetEventListenersResponse = {
      /**
       * Array of relevant listeners.
       */
      listeners: EventListener[];
    };
    /**
     * Removes DOM breakpoint that was set using `setDOMBreakpoint`.
     * @request `DOMDebugger.removeDOMBreakpoint`
     */
    export type RemoveDOMBreakpointRequest = {
      /**
       * Identifier of the node to remove breakpoint from.
       */
      nodeId: DOM.NodeId;
      /**
       * Type of the breakpoint to remove.
       */
      type: DOMBreakpointType;
    };
    /**
     * Removes DOM breakpoint that was set using `setDOMBreakpoint`.
     * @response `DOMDebugger.removeDOMBreakpoint`
     */
    export type RemoveDOMBreakpointResponse = {};
    /**
     * Removes breakpoint on particular DOM event.
     * @request `DOMDebugger.removeEventListenerBreakpoint`
     */
    export type RemoveEventListenerBreakpointRequest = {
      /**
       * Event name.
       */
      eventName: string;
      /**
       * EventTarget interface name.
       */
      targetName?: string | undefined;
    };
    /**
     * Removes breakpoint on particular DOM event.
     * @response `DOMDebugger.removeEventListenerBreakpoint`
     */
    export type RemoveEventListenerBreakpointResponse = {};
    /**
     * Removes breakpoint on particular native event.
     * @request `DOMDebugger.removeInstrumentationBreakpoint`
     */
    export type RemoveInstrumentationBreakpointRequest = {
      /**
       * Instrumentation name to stop on.
       */
      eventName: string;
    };
    /**
     * Removes breakpoint on particular native event.
     * @response `DOMDebugger.removeInstrumentationBreakpoint`
     */
    export type RemoveInstrumentationBreakpointResponse = {};
    /**
     * Removes breakpoint from XMLHttpRequest.
     * @request `DOMDebugger.removeXHRBreakpoint`
     */
    export type RemoveXHRBreakpointRequest = {
      /**
       * Resource URL substring.
       */
      url: string;
    };
    /**
     * Removes breakpoint from XMLHttpRequest.
     * @response `DOMDebugger.removeXHRBreakpoint`
     */
    export type RemoveXHRBreakpointResponse = {};
    /**
     * Sets breakpoint on particular CSP violations.
     * @request `DOMDebugger.setBreakOnCSPViolation`
     */
    export type SetBreakOnCSPViolationRequest = {
      /**
       * CSP Violations to stop upon.
       */
      violationTypes: CSPViolationType[];
    };
    /**
     * Sets breakpoint on particular CSP violations.
     * @response `DOMDebugger.setBreakOnCSPViolation`
     */
    export type SetBreakOnCSPViolationResponse = {};
    /**
     * Sets breakpoint on particular operation with DOM.
     * @request `DOMDebugger.setDOMBreakpoint`
     */
    export type SetDOMBreakpointRequest = {
      /**
       * Identifier of the node to set breakpoint on.
       */
      nodeId: DOM.NodeId;
      /**
       * Type of the operation to stop upon.
       */
      type: DOMBreakpointType;
    };
    /**
     * Sets breakpoint on particular operation with DOM.
     * @response `DOMDebugger.setDOMBreakpoint`
     */
    export type SetDOMBreakpointResponse = {};
    /**
     * Sets breakpoint on particular DOM event.
     * @request `DOMDebugger.setEventListenerBreakpoint`
     */
    export type SetEventListenerBreakpointRequest = {
      /**
       * DOM Event name to stop on (any DOM event will do).
       */
      eventName: string;
      /**
       * EventTarget interface name to stop on. If equal to `"*"` or not provided, will stop on any
       * EventTarget.
       */
      targetName?: string | undefined;
    };
    /**
     * Sets breakpoint on particular DOM event.
     * @response `DOMDebugger.setEventListenerBreakpoint`
     */
    export type SetEventListenerBreakpointResponse = {};
    /**
     * Sets breakpoint on particular native event.
     * @request `DOMDebugger.setInstrumentationBreakpoint`
     */
    export type SetInstrumentationBreakpointRequest = {
      /**
       * Instrumentation name to stop on.
       */
      eventName: string;
    };
    /**
     * Sets breakpoint on particular native event.
     * @response `DOMDebugger.setInstrumentationBreakpoint`
     */
    export type SetInstrumentationBreakpointResponse = {};
    /**
     * Sets breakpoint on XMLHttpRequest.
     * @request `DOMDebugger.setXHRBreakpoint`
     */
    export type SetXHRBreakpointRequest = {
      /**
       * Resource URL substring. All XHRs having this substring in the URL will get stopped upon.
       */
      url: string;
    };
    /**
     * Sets breakpoint on XMLHttpRequest.
     * @response `DOMDebugger.setXHRBreakpoint`
     */
    export type SetXHRBreakpointResponse = {};
  }
  export namespace DOMSnapshot {
    /**
     * A Node in the DOM tree.
     */
    export type DOMNode = {
      /**
       * `Node`'s nodeType.
       */
      nodeType: number;
      /**
       * `Node`'s nodeName.
       */
      nodeName: string;
      /**
       * `Node`'s nodeValue.
       */
      nodeValue: string;
      /**
       * Only set for textarea elements, contains the text value.
       */
      textValue?: string | undefined;
      /**
       * Only set for input elements, contains the input's associated text value.
       */
      inputValue?: string | undefined;
      /**
       * Only set for radio and checkbox input elements, indicates if the element has been checked
       */
      inputChecked?: boolean | undefined;
      /**
       * Only set for option elements, indicates if the element has been selected
       */
      optionSelected?: boolean | undefined;
      /**
       * `Node`'s id, corresponds to DOM.Node.backendNodeId.
       */
      backendNodeId: DOM.BackendNodeId;
      /**
       * The indexes of the node's child nodes in the `domNodes` array returned by `getSnapshot`, if
       * any.
       */
      childNodeIndexes?: number[] | undefined;
      /**
       * Attributes of an `Element` node.
       */
      attributes?: NameValue[] | undefined;
      /**
       * Indexes of pseudo elements associated with this node in the `domNodes` array returned by
       * `getSnapshot`, if any.
       */
      pseudoElementIndexes?: number[] | undefined;
      /**
       * The index of the node's related layout tree node in the `layoutTreeNodes` array returned by
       * `getSnapshot`, if any.
       */
      layoutNodeIndex?: number | undefined;
      /**
       * Document URL that `Document` or `FrameOwner` node points to.
       */
      documentURL?: string | undefined;
      /**
       * Base URL that `Document` or `FrameOwner` node uses for URL completion.
       */
      baseURL?: string | undefined;
      /**
       * Only set for documents, contains the document's content language.
       */
      contentLanguage?: string | undefined;
      /**
       * Only set for documents, contains the document's character set encoding.
       */
      documentEncoding?: string | undefined;
      /**
       * `DocumentType` node's publicId.
       */
      publicId?: string | undefined;
      /**
       * `DocumentType` node's systemId.
       */
      systemId?: string | undefined;
      /**
       * Frame ID for frame owner elements and also for the document node.
       */
      frameId?: Page.FrameId | undefined;
      /**
       * The index of a frame owner element's content document in the `domNodes` array returned by
       * `getSnapshot`, if any.
       */
      contentDocumentIndex?: number | undefined;
      /**
       * Type of a pseudo element node.
       */
      pseudoType?: DOM.PseudoType | undefined;
      /**
       * Shadow root type.
       */
      shadowRootType?: DOM.ShadowRootType | undefined;
      /**
       * Whether this DOM node responds to mouse clicks. This includes nodes that have had click
       * event listeners attached via JavaScript as well as anchor tags that naturally navigate when
       * clicked.
       */
      isClickable?: boolean | undefined;
      /**
       * Details of the node's event listeners, if any.
       */
      eventListeners?: DOMDebugger.EventListener[] | undefined;
      /**
       * The selected url for nodes with a srcset attribute.
       */
      currentSourceURL?: string | undefined;
      /**
       * The url of the script (if any) that generates this node.
       */
      originURL?: string | undefined;
      /**
       * Scroll offsets, set when this node is a Document.
       */
      scrollOffsetX?: number | undefined;
      scrollOffsetY?: number | undefined;
    };
    /**
     * Details of post layout rendered text positions. The exact layout should not be regarded as
     * stable and may change between versions.
     */
    export type InlineTextBox = {
      /**
       * The bounding box in document coordinates. Note that scroll offset of the document is ignored.
       */
      boundingBox: DOM.Rect;
      /**
       * The starting index in characters, for this post layout textbox substring. Characters that
       * would be represented as a surrogate pair in UTF-16 have length 2.
       */
      startCharacterIndex: number;
      /**
       * The number of characters in this post layout textbox substring. Characters that would be
       * represented as a surrogate pair in UTF-16 have length 2.
       */
      numCharacters: number;
    };
    /**
     * Details of an element in the DOM tree with a LayoutObject.
     */
    export type LayoutTreeNode = {
      /**
       * The index of the related DOM node in the `domNodes` array returned by `getSnapshot`.
       */
      domNodeIndex: number;
      /**
       * The bounding box in document coordinates. Note that scroll offset of the document is ignored.
       */
      boundingBox: DOM.Rect;
      /**
       * Contents of the LayoutText, if any.
       */
      layoutText?: string | undefined;
      /**
       * The post-layout inline text nodes, if any.
       */
      inlineTextNodes?: InlineTextBox[] | undefined;
      /**
       * Index into the `computedStyles` array returned by `getSnapshot`.
       */
      styleIndex?: number | undefined;
      /**
       * Global paint order index, which is determined by the stacking order of the nodes. Nodes
       * that are painted together will have the same index. Only provided if includePaintOrder in
       * getSnapshot was true.
       */
      paintOrder?: number | undefined;
      /**
       * Set to true to indicate the element begins a new stacking context.
       */
      isStackingContext?: boolean | undefined;
    };
    /**
     * A subset of the full ComputedStyle as defined by the request whitelist.
     */
    export type ComputedStyle = {
      /**
       * Name/value pairs of computed style properties.
       */
      properties: NameValue[];
    };
    /**
     * A name/value pair.
     */
    export type NameValue = {
      /**
       * Attribute/property name.
       */
      name: string;
      /**
       * Attribute/property value.
       */
      value: string;
    };
    /**
     * Index of the string in the strings table.
     */
    export type StringIndex = number;
    /**
     * Index of the string in the strings table.
     */
    export type ArrayOfStrings = StringIndex[];
    /**
     * Data that is only present on rare nodes.
     */
    export type RareStringData = {
      index: number[];
      value: StringIndex[];
    };
    export type RareBooleanData = {
      index: number[];
    };
    export type RareIntegerData = {
      index: number[];
      value: number[];
    };
    export type Rectangle = number[];
    /**
     * Document snapshot.
     */
    export type DocumentSnapshot = {
      /**
       * Document URL that `Document` or `FrameOwner` node points to.
       */
      documentURL: StringIndex;
      /**
       * Document title.
       */
      title: StringIndex;
      /**
       * Base URL that `Document` or `FrameOwner` node uses for URL completion.
       */
      baseURL: StringIndex;
      /**
       * Contains the document's content language.
       */
      contentLanguage: StringIndex;
      /**
       * Contains the document's character set encoding.
       */
      encodingName: StringIndex;
      /**
       * `DocumentType` node's publicId.
       */
      publicId: StringIndex;
      /**
       * `DocumentType` node's systemId.
       */
      systemId: StringIndex;
      /**
       * Frame ID for frame owner elements and also for the document node.
       */
      frameId: StringIndex;
      /**
       * A table with dom nodes.
       */
      nodes: NodeTreeSnapshot;
      /**
       * The nodes in the layout tree.
       */
      layout: LayoutTreeSnapshot;
      /**
       * The post-layout inline text nodes.
       */
      textBoxes: TextBoxSnapshot;
      /**
       * Horizontal scroll offset.
       */
      scrollOffsetX?: number | undefined;
      /**
       * Vertical scroll offset.
       */
      scrollOffsetY?: number | undefined;
      /**
       * Document content width.
       */
      contentWidth?: number | undefined;
      /**
       * Document content height.
       */
      contentHeight?: number | undefined;
    };
    /**
     * Table containing nodes.
     */
    export type NodeTreeSnapshot = {
      /**
       * Parent node index.
       */
      parentIndex?: number[] | undefined;
      /**
       * `Node`'s nodeType.
       */
      nodeType?: number[] | undefined;
      /**
       * Type of the shadow root the `Node` is in. String values are equal to the `ShadowRootType` enum.
       */
      shadowRootType?: RareStringData | undefined;
      /**
       * `Node`'s nodeName.
       */
      nodeName?: StringIndex[] | undefined;
      /**
       * `Node`'s nodeValue.
       */
      nodeValue?: StringIndex[] | undefined;
      /**
       * `Node`'s id, corresponds to DOM.Node.backendNodeId.
       */
      backendNodeId?: DOM.BackendNodeId[] | undefined;
      /**
       * Attributes of an `Element` node. Flatten name, value pairs.
       */
      attributes?: ArrayOfStrings[] | undefined;
      /**
       * Only set for textarea elements, contains the text value.
       */
      textValue?: RareStringData | undefined;
      /**
       * Only set for input elements, contains the input's associated text value.
       */
      inputValue?: RareStringData | undefined;
      /**
       * Only set for radio and checkbox input elements, indicates if the element has been checked
       */
      inputChecked?: RareBooleanData | undefined;
      /**
       * Only set for option elements, indicates if the element has been selected
       */
      optionSelected?: RareBooleanData | undefined;
      /**
       * The index of the document in the list of the snapshot documents.
       */
      contentDocumentIndex?: RareIntegerData | undefined;
      /**
       * Type of a pseudo element node.
       */
      pseudoType?: RareStringData | undefined;
      /**
       * Pseudo element identifier for this node. Only present if there is a
       * valid pseudoType.
       */
      pseudoIdentifier?: RareStringData | undefined;
      /**
       * Whether this DOM node responds to mouse clicks. This includes nodes that have had click
       * event listeners attached via JavaScript as well as anchor tags that naturally navigate when
       * clicked.
       */
      isClickable?: RareBooleanData | undefined;
      /**
       * The selected url for nodes with a srcset attribute.
       */
      currentSourceURL?: RareStringData | undefined;
      /**
       * The url of the script (if any) that generates this node.
       */
      originURL?: RareStringData | undefined;
    };
    /**
     * Table of details of an element in the DOM tree with a LayoutObject.
     */
    export type LayoutTreeSnapshot = {
      /**
       * Index of the corresponding node in the `NodeTreeSnapshot` array returned by `captureSnapshot`.
       */
      nodeIndex: number[];
      /**
       * Array of indexes specifying computed style strings, filtered according to the `computedStyles` parameter passed to `captureSnapshot`.
       */
      styles: ArrayOfStrings[];
      /**
       * The absolute position bounding box.
       */
      bounds: Rectangle[];
      /**
       * Contents of the LayoutText, if any.
       */
      text: StringIndex[];
      /**
       * Stacking context information.
       */
      stackingContexts: RareBooleanData;
      /**
       * Global paint order index, which is determined by the stacking order of the nodes. Nodes
       * that are painted together will have the same index. Only provided if includePaintOrder in
       * captureSnapshot was true.
       */
      paintOrders?: number[] | undefined;
      /**
       * The offset rect of nodes. Only available when includeDOMRects is set to true
       */
      offsetRects?: Rectangle[] | undefined;
      /**
       * The scroll rect of nodes. Only available when includeDOMRects is set to true
       */
      scrollRects?: Rectangle[] | undefined;
      /**
       * The client rect of nodes. Only available when includeDOMRects is set to true
       */
      clientRects?: Rectangle[] | undefined;
      /**
       * The list of background colors that are blended with colors of overlapping elements.
       */
      blendedBackgroundColors?: StringIndex[] | undefined;
      /**
       * The list of computed text opacities.
       */
      textColorOpacities?: number[] | undefined;
    };
    /**
     * Table of details of the post layout rendered text positions. The exact layout should not be regarded as
     * stable and may change between versions.
     */
    export type TextBoxSnapshot = {
      /**
       * Index of the layout tree node that owns this box collection.
       */
      layoutIndex: number[];
      /**
       * The absolute position bounding box.
       */
      bounds: Rectangle[];
      /**
       * The starting index in characters, for this post layout textbox substring. Characters that
       * would be represented as a surrogate pair in UTF-16 have length 2.
       */
      start: number[];
      /**
       * The number of characters in this post layout textbox substring. Characters that would be
       * represented as a surrogate pair in UTF-16 have length 2.
       */
      length: number[];
    };
    /**
     * Disables DOM snapshot agent for the given page.
     * @request `DOMSnapshot.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables DOM snapshot agent for the given page.
     * @response `DOMSnapshot.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables DOM snapshot agent for the given page.
     * @request `DOMSnapshot.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables DOM snapshot agent for the given page.
     * @response `DOMSnapshot.enable`
     */
    export type EnableResponse = {};
    /**
     * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
     * template contents, and imported documents) in a flattened array, as well as layout and
     * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
     * flattened.
     * @request `DOMSnapshot.getSnapshot`
     */
    export type GetSnapshotRequest = {
      /**
       * Whitelist of computed styles to return.
       */
      computedStyleWhitelist: string[];
      /**
       * Whether or not to retrieve details of DOM listeners (default false).
       */
      includeEventListeners?: boolean | undefined;
      /**
       * Whether to determine and include the paint order index of LayoutTreeNodes (default false).
       */
      includePaintOrder?: boolean | undefined;
      /**
       * Whether to include UA shadow tree in the snapshot (default false).
       */
      includeUserAgentShadowTree?: boolean | undefined;
    };
    /**
     * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
     * template contents, and imported documents) in a flattened array, as well as layout and
     * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
     * flattened.
     * @response `DOMSnapshot.getSnapshot`
     */
    export type GetSnapshotResponse = {
      /**
       * The nodes in the DOM tree. The DOMNode at index 0 corresponds to the root document.
       */
      domNodes: DOMNode[];
      /**
       * The nodes in the layout tree.
       */
      layoutTreeNodes: LayoutTreeNode[];
      /**
       * Whitelisted ComputedStyle properties for each node in the layout tree.
       */
      computedStyles: ComputedStyle[];
    };
    /**
     * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
     * template contents, and imported documents) in a flattened array, as well as layout and
     * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
     * flattened.
     * @request `DOMSnapshot.captureSnapshot`
     */
    export type CaptureSnapshotRequest = {
      /**
       * Whitelist of computed styles to return.
       */
      computedStyles: string[];
      /**
       * Whether to include layout object paint orders into the snapshot.
       */
      includePaintOrder?: boolean | undefined;
      /**
       * Whether to include DOM rectangles (offsetRects, clientRects, scrollRects) into the snapshot
       */
      includeDOMRects?: boolean | undefined;
      /**
       * Whether to include blended background colors in the snapshot (default: false).
       * Blended background color is achieved by blending background colors of all elements
       * that overlap with the current element.
       */
      includeBlendedBackgroundColors?: boolean | undefined;
      /**
       * Whether to include text color opacity in the snapshot (default: false).
       * An element might have the opacity property set that affects the text color of the element.
       * The final text color opacity is computed based on the opacity of all overlapping elements.
       */
      includeTextColorOpacities?: boolean | undefined;
    };
    /**
     * Returns a document snapshot, including the full DOM tree of the root node (including iframes,
     * template contents, and imported documents) in a flattened array, as well as layout and
     * white-listed computed style information for the nodes. Shadow DOM in the returned DOM tree is
     * flattened.
     * @response `DOMSnapshot.captureSnapshot`
     */
    export type CaptureSnapshotResponse = {
      /**
       * The nodes in the DOM tree. The DOMNode at index 0 corresponds to the root document.
       */
      documents: DocumentSnapshot[];
      /**
       * Shared string table that all string properties refer to with indexes.
       */
      strings: string[];
    };
  }
  export namespace DOMStorage {
    export type SerializedStorageKey = string;
    /**
     * DOM Storage identifier.
     */
    export type StorageId = {
      /**
       * Security origin for the storage.
       */
      securityOrigin?: string | undefined;
      /**
       * Represents a key by which DOM Storage keys its CachedStorageAreas
       */
      storageKey?: SerializedStorageKey | undefined;
      /**
       * Whether the storage is local storage (not session storage).
       */
      isLocalStorage: boolean;
    };
    /**
     * DOM Storage item.
     */
    export type Item = string[];
    /**
     * undefined
     * @event `DOMStorage.domStorageItemAdded`
     */
    export type DomStorageItemAddedEvent = {
      storageId: StorageId;
      key: string;
      newValue: string;
    };
    /**
     * undefined
     * @event `DOMStorage.domStorageItemRemoved`
     */
    export type DomStorageItemRemovedEvent = {
      storageId: StorageId;
      key: string;
    };
    /**
     * undefined
     * @event `DOMStorage.domStorageItemUpdated`
     */
    export type DomStorageItemUpdatedEvent = {
      storageId: StorageId;
      key: string;
      oldValue: string;
      newValue: string;
    };
    /**
     * undefined
     * @event `DOMStorage.domStorageItemsCleared`
     */
    export type DomStorageItemsClearedEvent = {
      storageId: StorageId;
    };
    /**
     * undefined
     * @request `DOMStorage.clear`
     */
    export type ClearRequest = {
      storageId: StorageId;
    };
    /**
     * undefined
     * @response `DOMStorage.clear`
     */
    export type ClearResponse = {};
    /**
     * Disables storage tracking, prevents storage events from being sent to the client.
     * @request `DOMStorage.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables storage tracking, prevents storage events from being sent to the client.
     * @response `DOMStorage.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables storage tracking, storage events will now be delivered to the client.
     * @request `DOMStorage.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables storage tracking, storage events will now be delivered to the client.
     * @response `DOMStorage.enable`
     */
    export type EnableResponse = {};
    /**
     * undefined
     * @request `DOMStorage.getDOMStorageItems`
     */
    export type GetDOMStorageItemsRequest = {
      storageId: StorageId;
    };
    /**
     * undefined
     * @response `DOMStorage.getDOMStorageItems`
     */
    export type GetDOMStorageItemsResponse = {
      entries: Item[];
    };
    /**
     * undefined
     * @request `DOMStorage.removeDOMStorageItem`
     */
    export type RemoveDOMStorageItemRequest = {
      storageId: StorageId;
      key: string;
    };
    /**
     * undefined
     * @response `DOMStorage.removeDOMStorageItem`
     */
    export type RemoveDOMStorageItemResponse = {};
    /**
     * undefined
     * @request `DOMStorage.setDOMStorageItem`
     */
    export type SetDOMStorageItemRequest = {
      storageId: StorageId;
      key: string;
      value: string;
    };
    /**
     * undefined
     * @response `DOMStorage.setDOMStorageItem`
     */
    export type SetDOMStorageItemResponse = {};
  }
  export namespace Emulation {
    /**
     * Screen orientation.
     */
    export type ScreenOrientation = {
      /**
       * Orientation type.
       */
      type: "portraitPrimary" | "portraitSecondary" | "landscapePrimary" | "landscapeSecondary";
      /**
       * Orientation angle.
       */
      angle: number;
    };
    export type DisplayFeature = {
      /**
       * Orientation of a display feature in relation to screen
       */
      orientation: "vertical" | "horizontal";
      /**
       * The offset from the screen origin in either the x (for vertical
       * orientation) or y (for horizontal orientation) direction.
       */
      offset: number;
      /**
       * A display feature may mask content such that it is not physically
       * displayed - this length along with the offset describes this area.
       * A display feature that only splits content will have a 0 mask_length.
       */
      maskLength: number;
    };
    export type DevicePosture = {
      /**
       * Current posture of the device
       */
      type: "continuous" | "folded";
    };
    export type MediaFeature = {
      name: string;
      value: string;
    };
    /**
     * advance: If the scheduler runs out of immediate work, the virtual time base may fast forward to
     * allow the next delayed task (if any) to run; pause: The virtual time base may not advance;
     * pauseIfNetworkFetchesPending: The virtual time base may not advance if there are any pending
     * resource fetches.
     */
    export type VirtualTimePolicy = "advance" | "pause" | "pauseIfNetworkFetchesPending";
    /**
     * Used to specify User Agent Cient Hints to emulate. See https://wicg.github.io/ua-client-hints
     */
    export type UserAgentBrandVersion = {
      brand: string;
      version: string;
    };
    /**
     * Used to specify User Agent Cient Hints to emulate. See https://wicg.github.io/ua-client-hints
     * Missing optional values will be filled in by the target with what it would normally use.
     */
    export type UserAgentMetadata = {
      /**
       * Brands appearing in Sec-CH-UA.
       */
      brands?: UserAgentBrandVersion[] | undefined;
      /**
       * Brands appearing in Sec-CH-UA-Full-Version-List.
       */
      fullVersionList?: UserAgentBrandVersion[] | undefined;
      fullVersion?: string | undefined;
      platform: string;
      platformVersion: string;
      architecture: string;
      model: string;
      mobile: boolean;
      bitness?: string | undefined;
      wow64?: boolean | undefined;
    };
    /**
     * Used to specify sensor types to emulate.
     * See https://w3c.github.io/sensors/#automation for more information.
     */
    export type SensorType =
      | "absolute-orientation"
      | "accelerometer"
      | "ambient-light"
      | "gravity"
      | "gyroscope"
      | "linear-acceleration"
      | "magnetometer"
      | "proximity"
      | "relative-orientation";
    export type SensorMetadata = {
      available?: boolean | undefined;
      minimumFrequency?: number | undefined;
      maximumFrequency?: number | undefined;
    };
    export type SensorReadingSingle = {
      value: number;
    };
    export type SensorReadingXYZ = {
      x: number;
      y: number;
      z: number;
    };
    export type SensorReadingQuaternion = {
      x: number;
      y: number;
      z: number;
      w: number;
    };
    export type SensorReading = {
      single?: SensorReadingSingle | undefined;
      xyz?: SensorReadingXYZ | undefined;
      quaternion?: SensorReadingQuaternion | undefined;
    };
    /**
     * Enum of image types that can be disabled.
     */
    export type DisabledImageType = "avif" | "webp";
    /**
     * Notification sent after the virtual time budget for the current VirtualTimePolicy has run out.
     * @event `Emulation.virtualTimeBudgetExpired`
     */
    export type VirtualTimeBudgetExpiredEvent = {};
    /**
     * Tells whether emulation is supported.
     * @request `Emulation.canEmulate`
     */
    export type CanEmulateRequest = {};
    /**
     * Tells whether emulation is supported.
     * @response `Emulation.canEmulate`
     */
    export type CanEmulateResponse = {
      /**
       * True if emulation is supported.
       */
      result: boolean;
    };
    /**
     * Clears the overridden device metrics.
     * @request `Emulation.clearDeviceMetricsOverride`
     */
    export type ClearDeviceMetricsOverrideRequest = {};
    /**
     * Clears the overridden device metrics.
     * @response `Emulation.clearDeviceMetricsOverride`
     */
    export type ClearDeviceMetricsOverrideResponse = {};
    /**
     * Clears the overridden Geolocation Position and Error.
     * @request `Emulation.clearGeolocationOverride`
     */
    export type ClearGeolocationOverrideRequest = {};
    /**
     * Clears the overridden Geolocation Position and Error.
     * @response `Emulation.clearGeolocationOverride`
     */
    export type ClearGeolocationOverrideResponse = {};
    /**
     * Requests that page scale factor is reset to initial values.
     * @request `Emulation.resetPageScaleFactor`
     */
    export type ResetPageScaleFactorRequest = {};
    /**
     * Requests that page scale factor is reset to initial values.
     * @response `Emulation.resetPageScaleFactor`
     */
    export type ResetPageScaleFactorResponse = {};
    /**
     * Enables or disables simulating a focused and active page.
     * @request `Emulation.setFocusEmulationEnabled`
     */
    export type SetFocusEmulationEnabledRequest = {
      /**
       * Whether to enable to disable focus emulation.
       */
      enabled: boolean;
    };
    /**
     * Enables or disables simulating a focused and active page.
     * @response `Emulation.setFocusEmulationEnabled`
     */
    export type SetFocusEmulationEnabledResponse = {};
    /**
     * Automatically render all web contents using a dark theme.
     * @request `Emulation.setAutoDarkModeOverride`
     */
    export type SetAutoDarkModeOverrideRequest = {
      /**
       * Whether to enable or disable automatic dark mode.
       * If not specified, any existing override will be cleared.
       */
      enabled?: boolean | undefined;
    };
    /**
     * Automatically render all web contents using a dark theme.
     * @response `Emulation.setAutoDarkModeOverride`
     */
    export type SetAutoDarkModeOverrideResponse = {};
    /**
     * Enables CPU throttling to emulate slow CPUs.
     * @request `Emulation.setCPUThrottlingRate`
     */
    export type SetCPUThrottlingRateRequest = {
      /**
       * Throttling rate as a slowdown factor (1 is no throttle, 2 is 2x slowdown, etc).
       */
      rate: number;
    };
    /**
     * Enables CPU throttling to emulate slow CPUs.
     * @response `Emulation.setCPUThrottlingRate`
     */
    export type SetCPUThrottlingRateResponse = {};
    /**
     * Sets or clears an override of the default background color of the frame. This override is used
     * if the content does not specify one.
     * @request `Emulation.setDefaultBackgroundColorOverride`
     */
    export type SetDefaultBackgroundColorOverrideRequest = {
      /**
       * RGBA of the default background color. If not specified, any existing override will be
       * cleared.
       */
      color?: DOM.RGBA | undefined;
    };
    /**
     * Sets or clears an override of the default background color of the frame. This override is used
     * if the content does not specify one.
     * @response `Emulation.setDefaultBackgroundColorOverride`
     */
    export type SetDefaultBackgroundColorOverrideResponse = {};
    /**
     * Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
     * window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
     * query results).
     * @request `Emulation.setDeviceMetricsOverride`
     */
    export type SetDeviceMetricsOverrideRequest = {
      /**
       * Overriding width value in pixels (minimum 0, maximum 10000000). 0 disables the override.
       */
      width: number;
      /**
       * Overriding height value in pixels (minimum 0, maximum 10000000). 0 disables the override.
       */
      height: number;
      /**
       * Overriding device scale factor value. 0 disables the override.
       */
      deviceScaleFactor: number;
      /**
       * Whether to emulate mobile device. This includes viewport meta tag, overlay scrollbars, text
       * autosizing and more.
       */
      mobile: boolean;
      /**
       * Scale to apply to resulting view image.
       */
      scale?: number | undefined;
      /**
       * Overriding screen width value in pixels (minimum 0, maximum 10000000).
       */
      screenWidth?: number | undefined;
      /**
       * Overriding screen height value in pixels (minimum 0, maximum 10000000).
       */
      screenHeight?: number | undefined;
      /**
       * Overriding view X position on screen in pixels (minimum 0, maximum 10000000).
       */
      positionX?: number | undefined;
      /**
       * Overriding view Y position on screen in pixels (minimum 0, maximum 10000000).
       */
      positionY?: number | undefined;
      /**
       * Do not set visible view size, rely upon explicit setVisibleSize call.
       */
      dontSetVisibleSize?: boolean | undefined;
      /**
       * Screen orientation override.
       */
      screenOrientation?: ScreenOrientation | undefined;
      /**
       * If set, the visible area of the page will be overridden to this viewport. This viewport
       * change is not observed by the page, e.g. viewport-relative elements do not change positions.
       */
      viewport?: Page.Viewport | undefined;
      /**
       * If set, the display feature of a multi-segment screen. If not set, multi-segment support
       * is turned-off.
       */
      displayFeature?: DisplayFeature | undefined;
      /**
       * If set, the posture of a foldable device. If not set the posture is set
       * to continuous.
       */
      devicePosture?: DevicePosture | undefined;
    };
    /**
     * Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
     * window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
     * query results).
     * @response `Emulation.setDeviceMetricsOverride`
     */
    export type SetDeviceMetricsOverrideResponse = {};
    /**
     * undefined
     * @request `Emulation.setScrollbarsHidden`
     */
    export type SetScrollbarsHiddenRequest = {
      /**
       * Whether scrollbars should be always hidden.
       */
      hidden: boolean;
    };
    /**
     * undefined
     * @response `Emulation.setScrollbarsHidden`
     */
    export type SetScrollbarsHiddenResponse = {};
    /**
     * undefined
     * @request `Emulation.setDocumentCookieDisabled`
     */
    export type SetDocumentCookieDisabledRequest = {
      /**
       * Whether document.coookie API should be disabled.
       */
      disabled: boolean;
    };
    /**
     * undefined
     * @response `Emulation.setDocumentCookieDisabled`
     */
    export type SetDocumentCookieDisabledResponse = {};
    /**
     * undefined
     * @request `Emulation.setEmitTouchEventsForMouse`
     */
    export type SetEmitTouchEventsForMouseRequest = {
      /**
       * Whether touch emulation based on mouse input should be enabled.
       */
      enabled: boolean;
      /**
       * Touch/gesture events configuration. Default: current platform.
       */
      configuration?: "mobile" | "desktop" | undefined;
    };
    /**
     * undefined
     * @response `Emulation.setEmitTouchEventsForMouse`
     */
    export type SetEmitTouchEventsForMouseResponse = {};
    /**
     * Emulates the given media type or media feature for CSS media queries.
     * @request `Emulation.setEmulatedMedia`
     */
    export type SetEmulatedMediaRequest = {
      /**
       * Media type to emulate. Empty string disables the override.
       */
      media?: string | undefined;
      /**
       * Media features to emulate.
       */
      features?: MediaFeature[] | undefined;
    };
    /**
     * Emulates the given media type or media feature for CSS media queries.
     * @response `Emulation.setEmulatedMedia`
     */
    export type SetEmulatedMediaResponse = {};
    /**
     * Emulates the given vision deficiency.
     * @request `Emulation.setEmulatedVisionDeficiency`
     */
    export type SetEmulatedVisionDeficiencyRequest = {
      /**
       * Vision deficiency to emulate. Order: best-effort emulations come first, followed by any
       * physiologically accurate emulations for medically recognized color vision deficiencies.
       */
      type:
        | "none"
        | "blurredVision"
        | "reducedContrast"
        | "achromatopsia"
        | "deuteranopia"
        | "protanopia"
        | "tritanopia";
    };
    /**
     * Emulates the given vision deficiency.
     * @response `Emulation.setEmulatedVisionDeficiency`
     */
    export type SetEmulatedVisionDeficiencyResponse = {};
    /**
     * Overrides the Geolocation Position or Error. Omitting any of the parameters emulates position
     * unavailable.
     * @request `Emulation.setGeolocationOverride`
     */
    export type SetGeolocationOverrideRequest = {
      /**
       * Mock latitude
       */
      latitude?: number | undefined;
      /**
       * Mock longitude
       */
      longitude?: number | undefined;
      /**
       * Mock accuracy
       */
      accuracy?: number | undefined;
    };
    /**
     * Overrides the Geolocation Position or Error. Omitting any of the parameters emulates position
     * unavailable.
     * @response `Emulation.setGeolocationOverride`
     */
    export type SetGeolocationOverrideResponse = {};
    /**
     * undefined
     * @request `Emulation.getOverriddenSensorInformation`
     */
    export type GetOverriddenSensorInformationRequest = {
      type: SensorType;
    };
    /**
     * undefined
     * @response `Emulation.getOverriddenSensorInformation`
     */
    export type GetOverriddenSensorInformationResponse = {
      requestedSamplingFrequency: number;
    };
    /**
     * Overrides a platform sensor of a given type. If |enabled| is true, calls to
     * Sensor.start() will use a virtual sensor as backend rather than fetching
     * data from a real hardware sensor. Otherwise, existing virtual
     * sensor-backend Sensor objects will fire an error event and new calls to
     * Sensor.start() will attempt to use a real sensor instead.
     * @request `Emulation.setSensorOverrideEnabled`
     */
    export type SetSensorOverrideEnabledRequest = {
      enabled: boolean;
      type: SensorType;
      metadata?: SensorMetadata | undefined;
    };
    /**
     * Overrides a platform sensor of a given type. If |enabled| is true, calls to
     * Sensor.start() will use a virtual sensor as backend rather than fetching
     * data from a real hardware sensor. Otherwise, existing virtual
     * sensor-backend Sensor objects will fire an error event and new calls to
     * Sensor.start() will attempt to use a real sensor instead.
     * @response `Emulation.setSensorOverrideEnabled`
     */
    export type SetSensorOverrideEnabledResponse = {};
    /**
     * Updates the sensor readings reported by a sensor type previously overriden
     * by setSensorOverrideEnabled.
     * @request `Emulation.setSensorOverrideReadings`
     */
    export type SetSensorOverrideReadingsRequest = {
      type: SensorType;
      reading: SensorReading;
    };
    /**
     * Updates the sensor readings reported by a sensor type previously overriden
     * by setSensorOverrideEnabled.
     * @response `Emulation.setSensorOverrideReadings`
     */
    export type SetSensorOverrideReadingsResponse = {};
    /**
     * Overrides the Idle state.
     * @request `Emulation.setIdleOverride`
     */
    export type SetIdleOverrideRequest = {
      /**
       * Mock isUserActive
       */
      isUserActive: boolean;
      /**
       * Mock isScreenUnlocked
       */
      isScreenUnlocked: boolean;
    };
    /**
     * Overrides the Idle state.
     * @response `Emulation.setIdleOverride`
     */
    export type SetIdleOverrideResponse = {};
    /**
     * Clears Idle state overrides.
     * @request `Emulation.clearIdleOverride`
     */
    export type ClearIdleOverrideRequest = {};
    /**
     * Clears Idle state overrides.
     * @response `Emulation.clearIdleOverride`
     */
    export type ClearIdleOverrideResponse = {};
    /**
     * Overrides value returned by the javascript navigator object.
     * @request `Emulation.setNavigatorOverrides`
     */
    export type SetNavigatorOverridesRequest = {
      /**
       * The platform navigator.platform should return.
       */
      platform: string;
    };
    /**
     * Overrides value returned by the javascript navigator object.
     * @response `Emulation.setNavigatorOverrides`
     */
    export type SetNavigatorOverridesResponse = {};
    /**
     * Sets a specified page scale factor.
     * @request `Emulation.setPageScaleFactor`
     */
    export type SetPageScaleFactorRequest = {
      /**
       * Page scale factor.
       */
      pageScaleFactor: number;
    };
    /**
     * Sets a specified page scale factor.
     * @response `Emulation.setPageScaleFactor`
     */
    export type SetPageScaleFactorResponse = {};
    /**
     * Switches script execution in the page.
     * @request `Emulation.setScriptExecutionDisabled`
     */
    export type SetScriptExecutionDisabledRequest = {
      /**
       * Whether script execution should be disabled in the page.
       */
      value: boolean;
    };
    /**
     * Switches script execution in the page.
     * @response `Emulation.setScriptExecutionDisabled`
     */
    export type SetScriptExecutionDisabledResponse = {};
    /**
     * Enables touch on platforms which do not support them.
     * @request `Emulation.setTouchEmulationEnabled`
     */
    export type SetTouchEmulationEnabledRequest = {
      /**
       * Whether the touch event emulation should be enabled.
       */
      enabled: boolean;
      /**
       * Maximum touch points supported. Defaults to one.
       */
      maxTouchPoints?: number | undefined;
    };
    /**
     * Enables touch on platforms which do not support them.
     * @response `Emulation.setTouchEmulationEnabled`
     */
    export type SetTouchEmulationEnabledResponse = {};
    /**
     * Turns on virtual time for all frames (replacing real-time with a synthetic time source) and sets
     * the current virtual time policy.  Note this supersedes any previous time budget.
     * @request `Emulation.setVirtualTimePolicy`
     */
    export type SetVirtualTimePolicyRequest = {
      policy: VirtualTimePolicy;
      /**
       * If set, after this many virtual milliseconds have elapsed virtual time will be paused and a
       * virtualTimeBudgetExpired event is sent.
       */
      budget?: number | undefined;
      /**
       * If set this specifies the maximum number of tasks that can be run before virtual is forced
       * forwards to prevent deadlock.
       */
      maxVirtualTimeTaskStarvationCount?: number | undefined;
      /**
       * If set, base::Time::Now will be overridden to initially return this value.
       */
      initialVirtualTime?: Network.TimeSinceEpoch | undefined;
    };
    /**
     * Turns on virtual time for all frames (replacing real-time with a synthetic time source) and sets
     * the current virtual time policy.  Note this supersedes any previous time budget.
     * @response `Emulation.setVirtualTimePolicy`
     */
    export type SetVirtualTimePolicyResponse = {
      /**
       * Absolute timestamp at which virtual time was first enabled (up time in milliseconds).
       */
      virtualTimeTicksBase: number;
    };
    /**
     * Overrides default host system locale with the specified one.
     * @request `Emulation.setLocaleOverride`
     */
    export type SetLocaleOverrideRequest = {
      /**
       * ICU style C locale (e.g. "en_US"). If not specified or empty, disables the override and
       * restores default host system locale.
       */
      locale?: string | undefined;
    };
    /**
     * Overrides default host system locale with the specified one.
     * @response `Emulation.setLocaleOverride`
     */
    export type SetLocaleOverrideResponse = {};
    /**
     * Overrides default host system timezone with the specified one.
     * @request `Emulation.setTimezoneOverride`
     */
    export type SetTimezoneOverrideRequest = {
      /**
       * The timezone identifier. If empty, disables the override and
       * restores default host system timezone.
       */
      timezoneId: string;
    };
    /**
     * Overrides default host system timezone with the specified one.
     * @response `Emulation.setTimezoneOverride`
     */
    export type SetTimezoneOverrideResponse = {};
    /**
     * Resizes the frame/viewport of the page. Note that this does not affect the frame's container
     * (e.g. browser window). Can be used to produce screenshots of the specified size. Not supported
     * on Android.
     * @request `Emulation.setVisibleSize`
     */
    export type SetVisibleSizeRequest = {
      /**
       * Frame width (DIP).
       */
      width: number;
      /**
       * Frame height (DIP).
       */
      height: number;
    };
    /**
     * Resizes the frame/viewport of the page. Note that this does not affect the frame's container
     * (e.g. browser window). Can be used to produce screenshots of the specified size. Not supported
     * on Android.
     * @response `Emulation.setVisibleSize`
     */
    export type SetVisibleSizeResponse = {};
    /**
     * undefined
     * @request `Emulation.setDisabledImageTypes`
     */
    export type SetDisabledImageTypesRequest = {
      /**
       * Image types to disable.
       */
      imageTypes: DisabledImageType[];
    };
    /**
     * undefined
     * @response `Emulation.setDisabledImageTypes`
     */
    export type SetDisabledImageTypesResponse = {};
    /**
     * undefined
     * @request `Emulation.setHardwareConcurrencyOverride`
     */
    export type SetHardwareConcurrencyOverrideRequest = {
      /**
       * Hardware concurrency to report
       */
      hardwareConcurrency: number;
    };
    /**
     * undefined
     * @response `Emulation.setHardwareConcurrencyOverride`
     */
    export type SetHardwareConcurrencyOverrideResponse = {};
    /**
     * Allows overriding user agent with the given string.
     * @request `Emulation.setUserAgentOverride`
     */
    export type SetUserAgentOverrideRequest = {
      /**
       * User agent to use.
       */
      userAgent: string;
      /**
       * Browser language to emulate.
       */
      acceptLanguage?: string | undefined;
      /**
       * The platform navigator.platform should return.
       */
      platform?: string | undefined;
      /**
       * To be sent in Sec-CH-UA-* headers and returned in navigator.userAgentData
       */
      userAgentMetadata?: UserAgentMetadata | undefined;
    };
    /**
     * Allows overriding user agent with the given string.
     * @response `Emulation.setUserAgentOverride`
     */
    export type SetUserAgentOverrideResponse = {};
    /**
     * Allows overriding the automation flag.
     * @request `Emulation.setAutomationOverride`
     */
    export type SetAutomationOverrideRequest = {
      /**
       * Whether the override should be enabled.
       */
      enabled: boolean;
    };
    /**
     * Allows overriding the automation flag.
     * @response `Emulation.setAutomationOverride`
     */
    export type SetAutomationOverrideResponse = {};
  }
  export namespace EventBreakpoints {
    /**
     * Sets breakpoint on particular native event.
     * @request `EventBreakpoints.setInstrumentationBreakpoint`
     */
    export type SetInstrumentationBreakpointRequest = {
      /**
       * Instrumentation name to stop on.
       */
      eventName: string;
    };
    /**
     * Sets breakpoint on particular native event.
     * @response `EventBreakpoints.setInstrumentationBreakpoint`
     */
    export type SetInstrumentationBreakpointResponse = {};
    /**
     * Removes breakpoint on particular native event.
     * @request `EventBreakpoints.removeInstrumentationBreakpoint`
     */
    export type RemoveInstrumentationBreakpointRequest = {
      /**
       * Instrumentation name to stop on.
       */
      eventName: string;
    };
    /**
     * Removes breakpoint on particular native event.
     * @response `EventBreakpoints.removeInstrumentationBreakpoint`
     */
    export type RemoveInstrumentationBreakpointResponse = {};
    /**
     * Removes all breakpoints
     * @request `EventBreakpoints.disable`
     */
    export type DisableRequest = {};
    /**
     * Removes all breakpoints
     * @response `EventBreakpoints.disable`
     */
    export type DisableResponse = {};
  }
  export namespace FedCm {
    /**
     * Whether this is a sign-up or sign-in action for this account, i.e.
     * whether this account has ever been used to sign in to this RP before.
     */
    export type LoginState = "SignIn" | "SignUp";
    /**
     * The types of FedCM dialogs.
     */
    export type DialogType = "AccountChooser" | "AutoReauthn" | "ConfirmIdpLogin" | "Error";
    /**
     * The buttons on the FedCM dialog.
     */
    export type DialogButton = "ConfirmIdpLoginContinue" | "ErrorGotIt" | "ErrorMoreDetails";
    /**
     * Corresponds to IdentityRequestAccount
     */
    export type Account = {
      accountId: string;
      email: string;
      name: string;
      givenName: string;
      pictureUrl: string;
      idpConfigUrl: string;
      idpLoginUrl: string;
      loginState: LoginState;
      /**
       * These two are only set if the loginState is signUp
       */
      termsOfServiceUrl?: string | undefined;
      privacyPolicyUrl?: string | undefined;
    };
    /**
     * undefined
     * @event `FedCm.dialogShown`
     */
    export type DialogShownEvent = {
      dialogId: string;
      dialogType: DialogType;
      accounts: Account[];
      /**
       * These exist primarily so that the caller can verify the
       * RP context was used appropriately.
       */
      title: string;
      subtitle?: string | undefined;
    };
    /**
     * Triggered when a dialog is closed, either by user action, JS abort,
     * or a command below.
     * @event `FedCm.dialogClosed`
     */
    export type DialogClosedEvent = {
      dialogId: string;
    };
    /**
     * undefined
     * @request `FedCm.enable`
     */
    export type EnableRequest = {
      /**
       * Allows callers to disable the promise rejection delay that would
       * normally happen, if this is unimportant to what's being tested.
       * (step 4 of https://fedidcg.github.io/FedCM/#browser-api-rp-sign-in)
       */
      disableRejectionDelay?: boolean | undefined;
    };
    /**
     * undefined
     * @response `FedCm.enable`
     */
    export type EnableResponse = {};
    /**
     * undefined
     * @request `FedCm.disable`
     */
    export type DisableRequest = {};
    /**
     * undefined
     * @response `FedCm.disable`
     */
    export type DisableResponse = {};
    /**
     * undefined
     * @request `FedCm.selectAccount`
     */
    export type SelectAccountRequest = {
      dialogId: string;
      accountIndex: number;
    };
    /**
     * undefined
     * @response `FedCm.selectAccount`
     */
    export type SelectAccountResponse = {};
    /**
     * undefined
     * @request `FedCm.clickDialogButton`
     */
    export type ClickDialogButtonRequest = {
      dialogId: string;
      dialogButton: DialogButton;
    };
    /**
     * undefined
     * @response `FedCm.clickDialogButton`
     */
    export type ClickDialogButtonResponse = {};
    /**
     * undefined
     * @request `FedCm.dismissDialog`
     */
    export type DismissDialogRequest = {
      dialogId: string;
      triggerCooldown?: boolean | undefined;
    };
    /**
     * undefined
     * @response `FedCm.dismissDialog`
     */
    export type DismissDialogResponse = {};
    /**
     * Resets the cooldown time, if any, to allow the next FedCM call to show
     * a dialog even if one was recently dismissed by the user.
     * @request `FedCm.resetCooldown`
     */
    export type ResetCooldownRequest = {};
    /**
     * Resets the cooldown time, if any, to allow the next FedCM call to show
     * a dialog even if one was recently dismissed by the user.
     * @response `FedCm.resetCooldown`
     */
    export type ResetCooldownResponse = {};
  }
  export namespace Fetch {
    /**
     * Unique request identifier.
     */
    export type RequestId = string;
    /**
     * Stages of the request to handle. Request will intercept before the request is
     * sent. Response will intercept after the response is received (but before response
     * body is received).
     */
    export type RequestStage = "Request" | "Response";
    export type RequestPattern = {
      /**
       * Wildcards (`'*'` -> zero or more, `'?'` -> exactly one) are allowed. Escape character is
       * backslash. Omitting is equivalent to `"*"`.
       */
      urlPattern?: string | undefined;
      /**
       * If set, only requests for matching resource types will be intercepted.
       */
      resourceType?: Network.ResourceType | undefined;
      /**
       * Stage at which to begin intercepting requests. Default is Request.
       */
      requestStage?: RequestStage | undefined;
    };
    /**
     * Response HTTP header entry
     */
    export type HeaderEntry = {
      name: string;
      value: string;
    };
    /**
     * Authorization challenge for HTTP status code 401 or 407.
     */
    export type AuthChallenge = {
      /**
       * Source of the authentication challenge.
       */
      source?: "Server" | "Proxy" | undefined;
      /**
       * Origin of the challenger.
       */
      origin: string;
      /**
       * The authentication scheme used, such as basic or digest
       */
      scheme: string;
      /**
       * The realm of the challenge. May be empty.
       */
      realm: string;
    };
    /**
     * Response to an AuthChallenge.
     */
    export type AuthChallengeResponse = {
      /**
       * The decision on what to do in response to the authorization challenge.  Default means
       * deferring to the default behavior of the net stack, which will likely either the Cancel
       * authentication or display a popup dialog box.
       */
      response: "Default" | "CancelAuth" | "ProvideCredentials";
      /**
       * The username to provide, possibly empty. Should only be set if response is
       * ProvideCredentials.
       */
      username?: string | undefined;
      /**
       * The password to provide, possibly empty. Should only be set if response is
       * ProvideCredentials.
       */
      password?: string | undefined;
    };
    /**
     * Issued when the domain is enabled and the request URL matches the
     * specified filter. The request is paused until the client responds
     * with one of continueRequest, failRequest or fulfillRequest.
     * The stage of the request can be determined by presence of responseErrorReason
     * and responseStatusCode -- the request is at the response stage if either
     * of these fields is present and in the request stage otherwise.
     * Redirect responses and subsequent requests are reported similarly to regular
     * responses and requests. Redirect responses may be distinguished by the value
     * of `responseStatusCode` (which is one of 301, 302, 303, 307, 308) along with
     * presence of the `location` header. Requests resulting from a redirect will
     * have `redirectedRequestId` field set.
     * @event `Fetch.requestPaused`
     */
    export type RequestPausedEvent = {
      /**
       * Each request the page makes will have a unique id.
       */
      requestId: RequestId;
      /**
       * The details of the request.
       */
      request: Network.Request;
      /**
       * The id of the frame that initiated the request.
       */
      frameId: Page.FrameId;
      /**
       * How the requested resource will be used.
       */
      resourceType: Network.ResourceType;
      /**
       * Response error if intercepted at response stage.
       */
      responseErrorReason?: Network.ErrorReason | undefined;
      /**
       * Response code if intercepted at response stage.
       */
      responseStatusCode?: number | undefined;
      /**
       * Response status text if intercepted at response stage.
       */
      responseStatusText?: string | undefined;
      /**
       * Response headers if intercepted at the response stage.
       */
      responseHeaders?: HeaderEntry[] | undefined;
      /**
       * If the intercepted request had a corresponding Network.requestWillBeSent event fired for it,
       * then this networkId will be the same as the requestId present in the requestWillBeSent event.
       */
      networkId?: Network.RequestId | undefined;
      /**
       * If the request is due to a redirect response from the server, the id of the request that
       * has caused the redirect.
       */
      redirectedRequestId?: RequestId | undefined;
    };
    /**
     * Issued when the domain is enabled with handleAuthRequests set to true.
     * The request is paused until client responds with continueWithAuth.
     * @event `Fetch.authRequired`
     */
    export type AuthRequiredEvent = {
      /**
       * Each request the page makes will have a unique id.
       */
      requestId: RequestId;
      /**
       * The details of the request.
       */
      request: Network.Request;
      /**
       * The id of the frame that initiated the request.
       */
      frameId: Page.FrameId;
      /**
       * How the requested resource will be used.
       */
      resourceType: Network.ResourceType;
      /**
       * Details of the Authorization Challenge encountered.
       * If this is set, client should respond with continueRequest that
       * contains AuthChallengeResponse.
       */
      authChallenge: AuthChallenge;
    };
    /**
     * Disables the fetch domain.
     * @request `Fetch.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables the fetch domain.
     * @response `Fetch.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables issuing of requestPaused events. A request will be paused until client
     * calls one of failRequest, fulfillRequest or continueRequest/continueWithAuth.
     * @request `Fetch.enable`
     */
    export type EnableRequest = {
      /**
       * If specified, only requests matching any of these patterns will produce
       * fetchRequested event and will be paused until clients response. If not set,
       * all requests will be affected.
       */
      patterns?: RequestPattern[] | undefined;
      /**
       * If true, authRequired events will be issued and requests will be paused
       * expecting a call to continueWithAuth.
       */
      handleAuthRequests?: boolean | undefined;
    };
    /**
     * Enables issuing of requestPaused events. A request will be paused until client
     * calls one of failRequest, fulfillRequest or continueRequest/continueWithAuth.
     * @response `Fetch.enable`
     */
    export type EnableResponse = {};
    /**
     * Causes the request to fail with specified reason.
     * @request `Fetch.failRequest`
     */
    export type FailRequestRequest = {
      /**
       * An id the client received in requestPaused event.
       */
      requestId: RequestId;
      /**
       * Causes the request to fail with the given reason.
       */
      errorReason: Network.ErrorReason;
    };
    /**
     * Causes the request to fail with specified reason.
     * @response `Fetch.failRequest`
     */
    export type FailRequestResponse = {};
    /**
     * Provides response to the request.
     * @request `Fetch.fulfillRequest`
     */
    export type FulfillRequestRequest = {
      /**
       * An id the client received in requestPaused event.
       */
      requestId: RequestId;
      /**
       * An HTTP response code.
       */
      responseCode: number;
      /**
       * Response headers.
       */
      responseHeaders?: HeaderEntry[] | undefined;
      /**
       * Alternative way of specifying response headers as a \0-separated
       * series of name: value pairs. Prefer the above method unless you
       * need to represent some non-UTF8 values that can't be transmitted
       * over the protocol as text. (Encoded as a base64 string when passed over JSON)
       */
      binaryResponseHeaders?: string | undefined;
      /**
       * A response body. If absent, original response body will be used if
       * the request is intercepted at the response stage and empty body
       * will be used if the request is intercepted at the request stage. (Encoded as a base64 string when passed over JSON)
       */
      body?: string | undefined;
      /**
       * A textual representation of responseCode.
       * If absent, a standard phrase matching responseCode is used.
       */
      responsePhrase?: string | undefined;
    };
    /**
     * Provides response to the request.
     * @response `Fetch.fulfillRequest`
     */
    export type FulfillRequestResponse = {};
    /**
     * Continues the request, optionally modifying some of its parameters.
     * @request `Fetch.continueRequest`
     */
    export type ContinueRequestRequest = {
      /**
       * An id the client received in requestPaused event.
       */
      requestId: RequestId;
      /**
       * If set, the request url will be modified in a way that's not observable by page.
       */
      url?: string | undefined;
      /**
       * If set, the request method is overridden.
       */
      method?: string | undefined;
      /**
       * If set, overrides the post data in the request. (Encoded as a base64 string when passed over JSON)
       */
      postData?: string | undefined;
      /**
       * If set, overrides the request headers. Note that the overrides do not
       * extend to subsequent redirect hops, if a redirect happens. Another override
       * may be applied to a different request produced by a redirect.
       */
      headers?: HeaderEntry[] | undefined;
      /**
       * If set, overrides response interception behavior for this request.
       */
      interceptResponse?: boolean | undefined;
    };
    /**
     * Continues the request, optionally modifying some of its parameters.
     * @response `Fetch.continueRequest`
     */
    export type ContinueRequestResponse = {};
    /**
     * Continues a request supplying authChallengeResponse following authRequired event.
     * @request `Fetch.continueWithAuth`
     */
    export type ContinueWithAuthRequest = {
      /**
       * An id the client received in authRequired event.
       */
      requestId: RequestId;
      /**
       * Response to  with an authChallenge.
       */
      authChallengeResponse: AuthChallengeResponse;
    };
    /**
     * Continues a request supplying authChallengeResponse following authRequired event.
     * @response `Fetch.continueWithAuth`
     */
    export type ContinueWithAuthResponse = {};
    /**
     * Continues loading of the paused response, optionally modifying the
     * response headers. If either responseCode or headers are modified, all of them
     * must be present.
     * @request `Fetch.continueResponse`
     */
    export type ContinueResponseRequest = {
      /**
       * An id the client received in requestPaused event.
       */
      requestId: RequestId;
      /**
       * An HTTP response code. If absent, original response code will be used.
       */
      responseCode?: number | undefined;
      /**
       * A textual representation of responseCode.
       * If absent, a standard phrase matching responseCode is used.
       */
      responsePhrase?: string | undefined;
      /**
       * Response headers. If absent, original response headers will be used.
       */
      responseHeaders?: HeaderEntry[] | undefined;
      /**
       * Alternative way of specifying response headers as a \0-separated
       * series of name: value pairs. Prefer the above method unless you
       * need to represent some non-UTF8 values that can't be transmitted
       * over the protocol as text. (Encoded as a base64 string when passed over JSON)
       */
      binaryResponseHeaders?: string | undefined;
    };
    /**
     * Continues loading of the paused response, optionally modifying the
     * response headers. If either responseCode or headers are modified, all of them
     * must be present.
     * @response `Fetch.continueResponse`
     */
    export type ContinueResponseResponse = {};
    /**
     * Causes the body of the response to be received from the server and
     * returned as a single string. May only be issued for a request that
     * is paused in the Response stage and is mutually exclusive with
     * takeResponseBodyForInterceptionAsStream. Calling other methods that
     * affect the request or disabling fetch domain before body is received
     * results in an undefined behavior.
     * Note that the response body is not available for redirects. Requests
     * paused in the _redirect received_ state may be differentiated by
     * `responseCode` and presence of `location` response header, see
     * comments to `requestPaused` for details.
     * @request `Fetch.getResponseBody`
     */
    export type GetResponseBodyRequest = {
      /**
       * Identifier for the intercepted request to get body for.
       */
      requestId: RequestId;
    };
    /**
     * Causes the body of the response to be received from the server and
     * returned as a single string. May only be issued for a request that
     * is paused in the Response stage and is mutually exclusive with
     * takeResponseBodyForInterceptionAsStream. Calling other methods that
     * affect the request or disabling fetch domain before body is received
     * results in an undefined behavior.
     * Note that the response body is not available for redirects. Requests
     * paused in the _redirect received_ state may be differentiated by
     * `responseCode` and presence of `location` response header, see
     * comments to `requestPaused` for details.
     * @response `Fetch.getResponseBody`
     */
    export type GetResponseBodyResponse = {
      /**
       * Response body.
       */
      body: string;
      /**
       * True, if content was sent as base64.
       */
      base64Encoded: boolean;
    };
    /**
     * Returns a handle to the stream representing the response body.
     * The request must be paused in the HeadersReceived stage.
     * Note that after this command the request can't be continued
     * as is -- client either needs to cancel it or to provide the
     * response body.
     * The stream only supports sequential read, IO.read will fail if the position
     * is specified.
     * This method is mutually exclusive with getResponseBody.
     * Calling other methods that affect the request or disabling fetch
     * domain before body is received results in an undefined behavior.
     * @request `Fetch.takeResponseBodyAsStream`
     */
    export type TakeResponseBodyAsStreamRequest = {
      requestId: RequestId;
    };
    /**
     * Returns a handle to the stream representing the response body.
     * The request must be paused in the HeadersReceived stage.
     * Note that after this command the request can't be continued
     * as is -- client either needs to cancel it or to provide the
     * response body.
     * The stream only supports sequential read, IO.read will fail if the position
     * is specified.
     * This method is mutually exclusive with getResponseBody.
     * Calling other methods that affect the request or disabling fetch
     * domain before body is received results in an undefined behavior.
     * @response `Fetch.takeResponseBodyAsStream`
     */
    export type TakeResponseBodyAsStreamResponse = {
      stream: IO.StreamHandle;
    };
  }
  export namespace HeadlessExperimental {
    /**
     * Encoding options for a screenshot.
     */
    export type ScreenshotParams = {
      /**
       * Image compression format (defaults to png).
       */
      format?: "jpeg" | "png" | "webp" | undefined;
      /**
       * Compression quality from range [0..100] (jpeg and webp only).
       */
      quality?: number | undefined;
      /**
       * Optimize image encoding for speed, not for resulting size (defaults to false)
       */
      optimizeForSpeed?: boolean | undefined;
    };
    /**
     * Sends a BeginFrame to the target and returns when the frame was completed. Optionally captures a
     * screenshot from the resulting frame. Requires that the target was created with enabled
     * BeginFrameControl. Designed for use with --run-all-compositor-stages-before-draw, see also
     * https://goo.gle/chrome-headless-rendering for more background.
     * @request `HeadlessExperimental.beginFrame`
     */
    export type BeginFrameRequest = {
      /**
       * Timestamp of this BeginFrame in Renderer TimeTicks (milliseconds of uptime). If not set,
       * the current time will be used.
       */
      frameTimeTicks?: number | undefined;
      /**
       * The interval between BeginFrames that is reported to the compositor, in milliseconds.
       * Defaults to a 60 frames/second interval, i.e. about 16.666 milliseconds.
       */
      interval?: number | undefined;
      /**
       * Whether updates should not be committed and drawn onto the display. False by default. If
       * true, only side effects of the BeginFrame will be run, such as layout and animations, but
       * any visual updates may not be visible on the display or in screenshots.
       */
      noDisplayUpdates?: boolean | undefined;
      /**
       * If set, a screenshot of the frame will be captured and returned in the response. Otherwise,
       * no screenshot will be captured. Note that capturing a screenshot can fail, for example,
       * during renderer initialization. In such a case, no screenshot data will be returned.
       */
      screenshot?: ScreenshotParams | undefined;
    };
    /**
     * Sends a BeginFrame to the target and returns when the frame was completed. Optionally captures a
     * screenshot from the resulting frame. Requires that the target was created with enabled
     * BeginFrameControl. Designed for use with --run-all-compositor-stages-before-draw, see also
     * https://goo.gle/chrome-headless-rendering for more background.
     * @response `HeadlessExperimental.beginFrame`
     */
    export type BeginFrameResponse = {
      /**
       * Whether the BeginFrame resulted in damage and, thus, a new frame was committed to the
       * display. Reported for diagnostic uses, may be removed in the future.
       */
      hasDamage: boolean;
      /**
       * Base64-encoded image data of the screenshot, if one was requested and successfully taken. (Encoded as a base64 string when passed over JSON)
       */
      screenshotData?: string | undefined;
    };
    /**
     * Disables headless events for the target.
     * @request `HeadlessExperimental.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables headless events for the target.
     * @response `HeadlessExperimental.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables headless events for the target.
     * @request `HeadlessExperimental.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables headless events for the target.
     * @response `HeadlessExperimental.enable`
     */
    export type EnableResponse = {};
  }
  export namespace IndexedDB {
    /**
     * Database with an array of object stores.
     */
    export type DatabaseWithObjectStores = {
      /**
       * Database name.
       */
      name: string;
      /**
       * Database version (type is not 'integer', as the standard
       * requires the version number to be 'unsigned long long')
       */
      version: number;
      /**
       * Object stores in this database.
       */
      objectStores: ObjectStore[];
    };
    /**
     * Object store.
     */
    export type ObjectStore = {
      /**
       * Object store name.
       */
      name: string;
      /**
       * Object store key path.
       */
      keyPath: KeyPath;
      /**
       * If true, object store has auto increment flag set.
       */
      autoIncrement: boolean;
      /**
       * Indexes in this object store.
       */
      indexes: ObjectStoreIndex[];
    };
    /**
     * Object store index.
     */
    export type ObjectStoreIndex = {
      /**
       * Index name.
       */
      name: string;
      /**
       * Index key path.
       */
      keyPath: KeyPath;
      /**
       * If true, index is unique.
       */
      unique: boolean;
      /**
       * If true, index allows multiple entries for a key.
       */
      multiEntry: boolean;
    };
    /**
     * Key.
     */
    export type Key = {
      /**
       * Key type.
       */
      type: "number" | "string" | "date" | "array";
      /**
       * Number value.
       */
      number?: number | undefined;
      /**
       * String value.
       */
      string?: string | undefined;
      /**
       * Date value.
       */
      date?: number | undefined;
      /**
       * Array value.
       */
      array?: Key[] | undefined;
    };
    /**
     * Key range.
     */
    export type KeyRange = {
      /**
       * Lower bound.
       */
      lower?: Key | undefined;
      /**
       * Upper bound.
       */
      upper?: Key | undefined;
      /**
       * If true lower bound is open.
       */
      lowerOpen: boolean;
      /**
       * If true upper bound is open.
       */
      upperOpen: boolean;
    };
    /**
     * Data entry.
     */
    export type DataEntry = {
      /**
       * Key object.
       */
      key: Runtime.RemoteObject;
      /**
       * Primary key object.
       */
      primaryKey: Runtime.RemoteObject;
      /**
       * Value object.
       */
      value: Runtime.RemoteObject;
    };
    /**
     * Key path.
     */
    export type KeyPath = {
      /**
       * Key path type.
       */
      type: "null" | "string" | "array";
      /**
       * String value.
       */
      string?: string | undefined;
      /**
       * Array value.
       */
      array?: string[] | undefined;
    };
    /**
     * Clears all entries from an object store.
     * @request `IndexedDB.clearObjectStore`
     */
    export type ClearObjectStoreRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
      /**
       * Database name.
       */
      databaseName: string;
      /**
       * Object store name.
       */
      objectStoreName: string;
    };
    /**
     * Clears all entries from an object store.
     * @response `IndexedDB.clearObjectStore`
     */
    export type ClearObjectStoreResponse = {};
    /**
     * Deletes a database.
     * @request `IndexedDB.deleteDatabase`
     */
    export type DeleteDatabaseRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
      /**
       * Database name.
       */
      databaseName: string;
    };
    /**
     * Deletes a database.
     * @response `IndexedDB.deleteDatabase`
     */
    export type DeleteDatabaseResponse = {};
    /**
     * Delete a range of entries from an object store
     * @request `IndexedDB.deleteObjectStoreEntries`
     */
    export type DeleteObjectStoreEntriesRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
      databaseName: string;
      objectStoreName: string;
      /**
       * Range of entry keys to delete
       */
      keyRange: KeyRange;
    };
    /**
     * Delete a range of entries from an object store
     * @response `IndexedDB.deleteObjectStoreEntries`
     */
    export type DeleteObjectStoreEntriesResponse = {};
    /**
     * Disables events from backend.
     * @request `IndexedDB.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables events from backend.
     * @response `IndexedDB.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables events from backend.
     * @request `IndexedDB.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables events from backend.
     * @response `IndexedDB.enable`
     */
    export type EnableResponse = {};
    /**
     * Requests data from object store or index.
     * @request `IndexedDB.requestData`
     */
    export type RequestDataRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
      /**
       * Database name.
       */
      databaseName: string;
      /**
       * Object store name.
       */
      objectStoreName: string;
      /**
       * Index name, empty string for object store data requests.
       */
      indexName: string;
      /**
       * Number of records to skip.
       */
      skipCount: number;
      /**
       * Number of records to fetch.
       */
      pageSize: number;
      /**
       * Key range.
       */
      keyRange?: KeyRange | undefined;
    };
    /**
     * Requests data from object store or index.
     * @response `IndexedDB.requestData`
     */
    export type RequestDataResponse = {
      /**
       * Array of object store data entries.
       */
      objectStoreDataEntries: DataEntry[];
      /**
       * If true, there are more entries to fetch in the given range.
       */
      hasMore: boolean;
    };
    /**
     * Gets metadata of an object store.
     * @request `IndexedDB.getMetadata`
     */
    export type GetMetadataRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
      /**
       * Database name.
       */
      databaseName: string;
      /**
       * Object store name.
       */
      objectStoreName: string;
    };
    /**
     * Gets metadata of an object store.
     * @response `IndexedDB.getMetadata`
     */
    export type GetMetadataResponse = {
      /**
       * the entries count
       */
      entriesCount: number;
      /**
       * the current value of key generator, to become the next inserted
       * key into the object store. Valid if objectStore.autoIncrement
       * is true.
       */
      keyGeneratorValue: number;
    };
    /**
     * Requests database with given name in given frame.
     * @request `IndexedDB.requestDatabase`
     */
    export type RequestDatabaseRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
      /**
       * Database name.
       */
      databaseName: string;
    };
    /**
     * Requests database with given name in given frame.
     * @response `IndexedDB.requestDatabase`
     */
    export type RequestDatabaseResponse = {
      /**
       * Database with an array of object stores.
       */
      databaseWithObjectStores: DatabaseWithObjectStores;
    };
    /**
     * Requests database names for given security origin.
     * @request `IndexedDB.requestDatabaseNames`
     */
    export type RequestDatabaseNamesRequest = {
      /**
       * At least and at most one of securityOrigin, storageKey, or storageBucket must be specified.
       * Security origin.
       */
      securityOrigin?: string | undefined;
      /**
       * Storage key.
       */
      storageKey?: string | undefined;
      /**
       * Storage bucket. If not specified, it uses the default bucket.
       */
      storageBucket?: Storage.StorageBucket | undefined;
    };
    /**
     * Requests database names for given security origin.
     * @response `IndexedDB.requestDatabaseNames`
     */
    export type RequestDatabaseNamesResponse = {
      /**
       * Database names for origin.
       */
      databaseNames: string[];
    };
  }
  export namespace Input {
    export type TouchPoint = {
      /**
       * X coordinate of the event relative to the main frame's viewport in CSS pixels.
       */
      x: number;
      /**
       * Y coordinate of the event relative to the main frame's viewport in CSS pixels. 0 refers to
       * the top of the viewport and Y increases as it proceeds towards the bottom of the viewport.
       */
      y: number;
      /**
       * X radius of the touch area (default: 1.0).
       */
      radiusX?: number | undefined;
      /**
       * Y radius of the touch area (default: 1.0).
       */
      radiusY?: number | undefined;
      /**
       * Rotation angle (default: 0.0).
       */
      rotationAngle?: number | undefined;
      /**
       * Force (default: 1.0).
       */
      force?: number | undefined;
      /**
       * The normalized tangential pressure, which has a range of [-1,1] (default: 0).
       */
      tangentialPressure?: number | undefined;
      /**
       * The plane angle between the Y-Z plane and the plane containing both the stylus axis and the Y axis, in degrees of the range [-90,90], a positive tiltX is to the right (default: 0)
       */
      tiltX?: number | undefined;
      /**
       * The plane angle between the X-Z plane and the plane containing both the stylus axis and the X axis, in degrees of the range [-90,90], a positive tiltY is towards the user (default: 0).
       */
      tiltY?: number | undefined;
      /**
       * The clockwise rotation of a pen stylus around its own major axis, in degrees in the range [0,359] (default: 0).
       */
      twist?: number | undefined;
      /**
       * Identifier used to track touch sources between events, must be unique within an event.
       */
      id?: number | undefined;
    };
    export type GestureSourceType = "default" | "touch" | "mouse";
    export type MouseButton = "none" | "left" | "middle" | "right" | "back" | "forward";
    /**
     * UTC time in seconds, counted from January 1, 1970.
     */
    export type TimeSinceEpoch = number;
    export type DragDataItem = {
      /**
       * Mime type of the dragged data.
       */
      mimeType: string;
      /**
       * Depending of the value of `mimeType`, it contains the dragged link,
       * text, HTML markup or any other data.
       */
      data: string;
      /**
       * Title associated with a link. Only valid when `mimeType` == "text/uri-list".
       */
      title?: string | undefined;
      /**
       * Stores the base URL for the contained markup. Only valid when `mimeType`
       * == "text/html".
       */
      baseURL?: string | undefined;
    };
    export type DragData = {
      items: DragDataItem[];
      /**
       * List of filenames that should be included when dropping
       */
      files?: string[] | undefined;
      /**
       * Bit field representing allowed drag operations. Copy = 1, Link = 2, Move = 16
       */
      dragOperationsMask: number;
    };
    /**
     * Emitted only when `Input.setInterceptDrags` is enabled. Use this data with `Input.dispatchDragEvent` to
     * restore normal drag and drop behavior.
     * @event `Input.dragIntercepted`
     */
    export type DragInterceptedEvent = {
      data: DragData;
    };
    /**
     * Dispatches a drag event into the page.
     * @request `Input.dispatchDragEvent`
     */
    export type DispatchDragEventRequest = {
      /**
       * Type of the drag event.
       */
      type: "dragEnter" | "dragOver" | "drop" | "dragCancel";
      /**
       * X coordinate of the event relative to the main frame's viewport in CSS pixels.
       */
      x: number;
      /**
       * Y coordinate of the event relative to the main frame's viewport in CSS pixels. 0 refers to
       * the top of the viewport and Y increases as it proceeds towards the bottom of the viewport.
       */
      y: number;
      data: DragData;
      /**
       * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
       * (default: 0).
       */
      modifiers?: number | undefined;
    };
    /**
     * Dispatches a drag event into the page.
     * @response `Input.dispatchDragEvent`
     */
    export type DispatchDragEventResponse = {};
    /**
     * Dispatches a key event to the page.
     * @request `Input.dispatchKeyEvent`
     */
    export type DispatchKeyEventRequest = {
      /**
       * Type of the key event.
       */
      type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
      /**
       * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
       * (default: 0).
       */
      modifiers?: number | undefined;
      /**
       * Time at which the event occurred.
       */
      timestamp?: TimeSinceEpoch | undefined;
      /**
       * Text as generated by processing a virtual key code with a keyboard layout. Not needed for
       * for `keyUp` and `rawKeyDown` events (default: "")
       */
      text?: string | undefined;
      /**
       * Text that would have been generated by the keyboard if no modifiers were pressed (except for
       * shift). Useful for shortcut (accelerator) key handling (default: "").
       */
      unmodifiedText?: string | undefined;
      /**
       * Unique key identifier (e.g., 'U+0041') (default: "").
       */
      keyIdentifier?: string | undefined;
      /**
       * Unique DOM defined string value for each physical key (e.g., 'KeyA') (default: "").
       */
      code?: string | undefined;
      /**
       * Unique DOM defined string value describing the meaning of the key in the context of active
       * modifiers, keyboard layout, etc (e.g., 'AltGr') (default: "").
       */
      key?: string | undefined;
      /**
       * Windows virtual key code (default: 0).
       */
      windowsVirtualKeyCode?: number | undefined;
      /**
       * Native virtual key code (default: 0).
       */
      nativeVirtualKeyCode?: number | undefined;
      /**
       * Whether the event was generated from auto repeat (default: false).
       */
      autoRepeat?: boolean | undefined;
      /**
       * Whether the event was generated from the keypad (default: false).
       */
      isKeypad?: boolean | undefined;
      /**
       * Whether the event was a system key event (default: false).
       */
      isSystemKey?: boolean | undefined;
      /**
       * Whether the event was from the left or right side of the keyboard. 1=Left, 2=Right (default:
       * 0).
       */
      location?: number | undefined;
      /**
       * Editing commands to send with the key event (e.g., 'selectAll') (default: []).
       * These are related to but not equal the command names used in `document.execCommand` and NSStandardKeyBindingResponding.
       * See https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/editing/commands/editor_command_names.h for valid command names.
       */
      commands?: string[] | undefined;
    };
    /**
     * Dispatches a key event to the page.
     * @response `Input.dispatchKeyEvent`
     */
    export type DispatchKeyEventResponse = {};
    /**
     * This method emulates inserting text that doesn't come from a key press,
     * for example an emoji keyboard or an IME.
     * @request `Input.insertText`
     */
    export type InsertTextRequest = {
      /**
       * The text to insert.
       */
      text: string;
    };
    /**
     * This method emulates inserting text that doesn't come from a key press,
     * for example an emoji keyboard or an IME.
     * @response `Input.insertText`
     */
    export type InsertTextResponse = {};
    /**
     * This method sets the current candidate text for ime.
     * Use imeCommitComposition to commit the final text.
     * Use imeSetComposition with empty string as text to cancel composition.
     * @request `Input.imeSetComposition`
     */
    export type ImeSetCompositionRequest = {
      /**
       * The text to insert
       */
      text: string;
      /**
       * selection start
       */
      selectionStart: number;
      /**
       * selection end
       */
      selectionEnd: number;
      /**
       * replacement start
       */
      replacementStart?: number | undefined;
      /**
       * replacement end
       */
      replacementEnd?: number | undefined;
    };
    /**
     * This method sets the current candidate text for ime.
     * Use imeCommitComposition to commit the final text.
     * Use imeSetComposition with empty string as text to cancel composition.
     * @response `Input.imeSetComposition`
     */
    export type ImeSetCompositionResponse = {};
    /**
     * Dispatches a mouse event to the page.
     * @request `Input.dispatchMouseEvent`
     */
    export type DispatchMouseEventRequest = {
      /**
       * Type of the mouse event.
       */
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      /**
       * X coordinate of the event relative to the main frame's viewport in CSS pixels.
       */
      x: number;
      /**
       * Y coordinate of the event relative to the main frame's viewport in CSS pixels. 0 refers to
       * the top of the viewport and Y increases as it proceeds towards the bottom of the viewport.
       */
      y: number;
      /**
       * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
       * (default: 0).
       */
      modifiers?: number | undefined;
      /**
       * Time at which the event occurred.
       */
      timestamp?: TimeSinceEpoch | undefined;
      /**
       * Mouse button (default: "none").
       */
      button?: MouseButton | undefined;
      /**
       * A number indicating which buttons are pressed on the mouse when a mouse event is triggered.
       * Left=1, Right=2, Middle=4, Back=8, Forward=16, None=0.
       */
      buttons?: number | undefined;
      /**
       * Number of times the mouse button was clicked (default: 0).
       */
      clickCount?: number | undefined;
      /**
       * The normalized pressure, which has a range of [0,1] (default: 0).
       */
      force?: number | undefined;
      /**
       * The normalized tangential pressure, which has a range of [-1,1] (default: 0).
       */
      tangentialPressure?: number | undefined;
      /**
       * The plane angle between the Y-Z plane and the plane containing both the stylus axis and the Y axis, in degrees of the range [-90,90], a positive tiltX is to the right (default: 0).
       */
      tiltX?: number | undefined;
      /**
       * The plane angle between the X-Z plane and the plane containing both the stylus axis and the X axis, in degrees of the range [-90,90], a positive tiltY is towards the user (default: 0).
       */
      tiltY?: number | undefined;
      /**
       * The clockwise rotation of a pen stylus around its own major axis, in degrees in the range [0,359] (default: 0).
       */
      twist?: number | undefined;
      /**
       * X delta in CSS pixels for mouse wheel event (default: 0).
       */
      deltaX?: number | undefined;
      /**
       * Y delta in CSS pixels for mouse wheel event (default: 0).
       */
      deltaY?: number | undefined;
      /**
       * Pointer type (default: "mouse").
       */
      pointerType?: "mouse" | "pen" | undefined;
    };
    /**
     * Dispatches a mouse event to the page.
     * @response `Input.dispatchMouseEvent`
     */
    export type DispatchMouseEventResponse = {};
    /**
     * Dispatches a touch event to the page.
     * @request `Input.dispatchTouchEvent`
     */
    export type DispatchTouchEventRequest = {
      /**
       * Type of the touch event. TouchEnd and TouchCancel must not contain any touch points, while
       * TouchStart and TouchMove must contains at least one.
       */
      type: "touchStart" | "touchEnd" | "touchMove" | "touchCancel";
      /**
       * Active touch points on the touch device. One event per any changed point (compared to
       * previous touch event in a sequence) is generated, emulating pressing/moving/releasing points
       * one by one.
       */
      touchPoints: TouchPoint[];
      /**
       * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
       * (default: 0).
       */
      modifiers?: number | undefined;
      /**
       * Time at which the event occurred.
       */
      timestamp?: TimeSinceEpoch | undefined;
    };
    /**
     * Dispatches a touch event to the page.
     * @response `Input.dispatchTouchEvent`
     */
    export type DispatchTouchEventResponse = {};
    /**
     * Cancels any active dragging in the page.
     * @request `Input.cancelDragging`
     */
    export type CancelDraggingRequest = {};
    /**
     * Cancels any active dragging in the page.
     * @response `Input.cancelDragging`
     */
    export type CancelDraggingResponse = {};
    /**
     * Emulates touch event from the mouse event parameters.
     * @request `Input.emulateTouchFromMouseEvent`
     */
    export type EmulateTouchFromMouseEventRequest = {
      /**
       * Type of the mouse event.
       */
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      /**
       * X coordinate of the mouse pointer in DIP.
       */
      x: number;
      /**
       * Y coordinate of the mouse pointer in DIP.
       */
      y: number;
      /**
       * Mouse button. Only "none", "left", "right" are supported.
       */
      button: MouseButton;
      /**
       * Time at which the event occurred (default: current time).
       */
      timestamp?: TimeSinceEpoch | undefined;
      /**
       * X delta in DIP for mouse wheel event (default: 0).
       */
      deltaX?: number | undefined;
      /**
       * Y delta in DIP for mouse wheel event (default: 0).
       */
      deltaY?: number | undefined;
      /**
       * Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8
       * (default: 0).
       */
      modifiers?: number | undefined;
      /**
       * Number of times the mouse button was clicked (default: 0).
       */
      clickCount?: number | undefined;
    };
    /**
     * Emulates touch event from the mouse event parameters.
     * @response `Input.emulateTouchFromMouseEvent`
     */
    export type EmulateTouchFromMouseEventResponse = {};
    /**
     * Ignores input events (useful while auditing page).
     * @request `Input.setIgnoreInputEvents`
     */
    export type SetIgnoreInputEventsRequest = {
      /**
       * Ignores input events processing when set to true.
       */
      ignore: boolean;
    };
    /**
     * Ignores input events (useful while auditing page).
     * @response `Input.setIgnoreInputEvents`
     */
    export type SetIgnoreInputEventsResponse = {};
    /**
     * Prevents default drag and drop behavior and instead emits `Input.dragIntercepted` events.
     * Drag and drop behavior can be directly controlled via `Input.dispatchDragEvent`.
     * @request `Input.setInterceptDrags`
     */
    export type SetInterceptDragsRequest = {
      enabled: boolean;
    };
    /**
     * Prevents default drag and drop behavior and instead emits `Input.dragIntercepted` events.
     * Drag and drop behavior can be directly controlled via `Input.dispatchDragEvent`.
     * @response `Input.setInterceptDrags`
     */
    export type SetInterceptDragsResponse = {};
    /**
     * Synthesizes a pinch gesture over a time period by issuing appropriate touch events.
     * @request `Input.synthesizePinchGesture`
     */
    export type SynthesizePinchGestureRequest = {
      /**
       * X coordinate of the start of the gesture in CSS pixels.
       */
      x: number;
      /**
       * Y coordinate of the start of the gesture in CSS pixels.
       */
      y: number;
      /**
       * Relative scale factor after zooming (>1.0 zooms in, <1.0 zooms out).
       */
      scaleFactor: number;
      /**
       * Relative pointer speed in pixels per second (default: 800).
       */
      relativeSpeed?: number | undefined;
      /**
       * Which type of input events to be generated (default: 'default', which queries the platform
       * for the preferred input type).
       */
      gestureSourceType?: GestureSourceType | undefined;
    };
    /**
     * Synthesizes a pinch gesture over a time period by issuing appropriate touch events.
     * @response `Input.synthesizePinchGesture`
     */
    export type SynthesizePinchGestureResponse = {};
    /**
     * Synthesizes a scroll gesture over a time period by issuing appropriate touch events.
     * @request `Input.synthesizeScrollGesture`
     */
    export type SynthesizeScrollGestureRequest = {
      /**
       * X coordinate of the start of the gesture in CSS pixels.
       */
      x: number;
      /**
       * Y coordinate of the start of the gesture in CSS pixels.
       */
      y: number;
      /**
       * The distance to scroll along the X axis (positive to scroll left).
       */
      xDistance?: number | undefined;
      /**
       * The distance to scroll along the Y axis (positive to scroll up).
       */
      yDistance?: number | undefined;
      /**
       * The number of additional pixels to scroll back along the X axis, in addition to the given
       * distance.
       */
      xOverscroll?: number | undefined;
      /**
       * The number of additional pixels to scroll back along the Y axis, in addition to the given
       * distance.
       */
      yOverscroll?: number | undefined;
      /**
       * Prevent fling (default: true).
       */
      preventFling?: boolean | undefined;
      /**
       * Swipe speed in pixels per second (default: 800).
       */
      speed?: number | undefined;
      /**
       * Which type of input events to be generated (default: 'default', which queries the platform
       * for the preferred input type).
       */
      gestureSourceType?: GestureSourceType | undefined;
      /**
       * The number of times to repeat the gesture (default: 0).
       */
      repeatCount?: number | undefined;
      /**
       * The number of milliseconds delay between each repeat. (default: 250).
       */
      repeatDelayMs?: number | undefined;
      /**
       * The name of the interaction markers to generate, if not empty (default: "").
       */
      interactionMarkerName?: string | undefined;
    };
    /**
     * Synthesizes a scroll gesture over a time period by issuing appropriate touch events.
     * @response `Input.synthesizeScrollGesture`
     */
    export type SynthesizeScrollGestureResponse = {};
    /**
     * Synthesizes a tap gesture over a time period by issuing appropriate touch events.
     * @request `Input.synthesizeTapGesture`
     */
    export type SynthesizeTapGestureRequest = {
      /**
       * X coordinate of the start of the gesture in CSS pixels.
       */
      x: number;
      /**
       * Y coordinate of the start of the gesture in CSS pixels.
       */
      y: number;
      /**
       * Duration between touchdown and touchup events in ms (default: 50).
       */
      duration?: number | undefined;
      /**
       * Number of times to perform the tap (e.g. 2 for double tap, default: 1).
       */
      tapCount?: number | undefined;
      /**
       * Which type of input events to be generated (default: 'default', which queries the platform
       * for the preferred input type).
       */
      gestureSourceType?: GestureSourceType | undefined;
    };
    /**
     * Synthesizes a tap gesture over a time period by issuing appropriate touch events.
     * @response `Input.synthesizeTapGesture`
     */
    export type SynthesizeTapGestureResponse = {};
  }
  export namespace IO {
    /**
     * This is either obtained from another method or specified as `blob:<uuid>` where
     * `<uuid>` is an UUID of a Blob.
     */
    export type StreamHandle = string;
    /**
     * Close the stream, discard any temporary backing storage.
     * @request `IO.close`
     */
    export type CloseRequest = {
      /**
       * Handle of the stream to close.
       */
      handle: StreamHandle;
    };
    /**
     * Close the stream, discard any temporary backing storage.
     * @response `IO.close`
     */
    export type CloseResponse = {};
    /**
     * Read a chunk of the stream
     * @request `IO.read`
     */
    export type ReadRequest = {
      /**
       * Handle of the stream to read.
       */
      handle: StreamHandle;
      /**
       * Seek to the specified offset before reading (if not specificed, proceed with offset
       * following the last read). Some types of streams may only support sequential reads.
       */
      offset?: number | undefined;
      /**
       * Maximum number of bytes to read (left upon the agent discretion if not specified).
       */
      size?: number | undefined;
    };
    /**
     * Read a chunk of the stream
     * @response `IO.read`
     */
    export type ReadResponse = {
      /**
       * Set if the data is base64-encoded
       */
      base64Encoded?: boolean | undefined;
      /**
       * Data that were read.
       */
      data: string;
      /**
       * Set if the end-of-file condition occurred while reading.
       */
      eof: boolean;
    };
    /**
     * Return UUID of Blob object specified by a remote object id.
     * @request `IO.resolveBlob`
     */
    export type ResolveBlobRequest = {
      /**
       * Object id of a Blob object wrapper.
       */
      objectId: Runtime.RemoteObjectId;
    };
    /**
     * Return UUID of Blob object specified by a remote object id.
     * @response `IO.resolveBlob`
     */
    export type ResolveBlobResponse = {
      /**
       * UUID of the specified Blob.
       */
      uuid: string;
    };
  }
  export namespace LayerTree {
    /**
     * Unique Layer identifier.
     */
    export type LayerId = string;
    /**
     * Unique snapshot identifier.
     */
    export type SnapshotId = string;
    /**
     * Rectangle where scrolling happens on the main thread.
     */
    export type ScrollRect = {
      /**
       * Rectangle itself.
       */
      rect: DOM.Rect;
      /**
       * Reason for rectangle to force scrolling on the main thread
       */
      type: "RepaintsOnScroll" | "TouchEventHandler" | "WheelEventHandler";
    };
    /**
     * Sticky position constraints.
     */
    export type StickyPositionConstraint = {
      /**
       * Layout rectangle of the sticky element before being shifted
       */
      stickyBoxRect: DOM.Rect;
      /**
       * Layout rectangle of the containing block of the sticky element
       */
      containingBlockRect: DOM.Rect;
      /**
       * The nearest sticky layer that shifts the sticky box
       */
      nearestLayerShiftingStickyBox?: LayerId | undefined;
      /**
       * The nearest sticky layer that shifts the containing block
       */
      nearestLayerShiftingContainingBlock?: LayerId | undefined;
    };
    /**
     * Serialized fragment of layer picture along with its offset within the layer.
     */
    export type PictureTile = {
      /**
       * Offset from owning layer left boundary
       */
      x: number;
      /**
       * Offset from owning layer top boundary
       */
      y: number;
      /**
       * Base64-encoded snapshot data. (Encoded as a base64 string when passed over JSON)
       */
      picture: string;
    };
    /**
     * Information about a compositing layer.
     */
    export type Layer = {
      /**
       * The unique id for this layer.
       */
      layerId: LayerId;
      /**
       * The id of parent (not present for root).
       */
      parentLayerId?: LayerId | undefined;
      /**
       * The backend id for the node associated with this layer.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * Offset from parent layer, X coordinate.
       */
      offsetX: number;
      /**
       * Offset from parent layer, Y coordinate.
       */
      offsetY: number;
      /**
       * Layer width.
       */
      width: number;
      /**
       * Layer height.
       */
      height: number;
      /**
       * Transformation matrix for layer, default is identity matrix
       */
      transform?: number[] | undefined;
      /**
       * Transform anchor point X, absent if no transform specified
       */
      anchorX?: number | undefined;
      /**
       * Transform anchor point Y, absent if no transform specified
       */
      anchorY?: number | undefined;
      /**
       * Transform anchor point Z, absent if no transform specified
       */
      anchorZ?: number | undefined;
      /**
       * Indicates how many time this layer has painted.
       */
      paintCount: number;
      /**
       * Indicates whether this layer hosts any content, rather than being used for
       * transform/scrolling purposes only.
       */
      drawsContent: boolean;
      /**
       * Set if layer is not visible.
       */
      invisible?: boolean | undefined;
      /**
       * Rectangles scrolling on main thread only.
       */
      scrollRects?: ScrollRect[] | undefined;
      /**
       * Sticky position constraint information
       */
      stickyPositionConstraint?: StickyPositionConstraint | undefined;
    };
    /**
     * Array of timings, one per paint step.
     */
    export type PaintProfile = number[];
    /**
     * undefined
     * @event `LayerTree.layerPainted`
     */
    export type LayerPaintedEvent = {
      /**
       * The id of the painted layer.
       */
      layerId: LayerId;
      /**
       * Clip rectangle.
       */
      clip: DOM.Rect;
    };
    /**
     * undefined
     * @event `LayerTree.layerTreeDidChange`
     */
    export type LayerTreeDidChangeEvent = {
      /**
       * Layer tree, absent if not in the comspositing mode.
       */
      layers?: Layer[] | undefined;
    };
    /**
     * Provides the reasons why the given layer was composited.
     * @request `LayerTree.compositingReasons`
     */
    export type CompositingReasonsRequest = {
      /**
       * The id of the layer for which we want to get the reasons it was composited.
       */
      layerId: LayerId;
    };
    /**
     * Provides the reasons why the given layer was composited.
     * @response `LayerTree.compositingReasons`
     */
    export type CompositingReasonsResponse = {
      /**
       * A list of strings specifying reasons for the given layer to become composited.
       */
      compositingReasons: string[];
      /**
       * A list of strings specifying reason IDs for the given layer to become composited.
       */
      compositingReasonIds: string[];
    };
    /**
     * Disables compositing tree inspection.
     * @request `LayerTree.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables compositing tree inspection.
     * @response `LayerTree.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables compositing tree inspection.
     * @request `LayerTree.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables compositing tree inspection.
     * @response `LayerTree.enable`
     */
    export type EnableResponse = {};
    /**
     * Returns the snapshot identifier.
     * @request `LayerTree.loadSnapshot`
     */
    export type LoadSnapshotRequest = {
      /**
       * An array of tiles composing the snapshot.
       */
      tiles: PictureTile[];
    };
    /**
     * Returns the snapshot identifier.
     * @response `LayerTree.loadSnapshot`
     */
    export type LoadSnapshotResponse = {
      /**
       * The id of the snapshot.
       */
      snapshotId: SnapshotId;
    };
    /**
     * Returns the layer snapshot identifier.
     * @request `LayerTree.makeSnapshot`
     */
    export type MakeSnapshotRequest = {
      /**
       * The id of the layer.
       */
      layerId: LayerId;
    };
    /**
     * Returns the layer snapshot identifier.
     * @response `LayerTree.makeSnapshot`
     */
    export type MakeSnapshotResponse = {
      /**
       * The id of the layer snapshot.
       */
      snapshotId: SnapshotId;
    };
    /**
     * undefined
     * @request `LayerTree.profileSnapshot`
     */
    export type ProfileSnapshotRequest = {
      /**
       * The id of the layer snapshot.
       */
      snapshotId: SnapshotId;
      /**
       * The maximum number of times to replay the snapshot (1, if not specified).
       */
      minRepeatCount?: number | undefined;
      /**
       * The minimum duration (in seconds) to replay the snapshot.
       */
      minDuration?: number | undefined;
      /**
       * The clip rectangle to apply when replaying the snapshot.
       */
      clipRect?: DOM.Rect | undefined;
    };
    /**
     * undefined
     * @response `LayerTree.profileSnapshot`
     */
    export type ProfileSnapshotResponse = {
      /**
       * The array of paint profiles, one per run.
       */
      timings: PaintProfile[];
    };
    /**
     * Releases layer snapshot captured by the back-end.
     * @request `LayerTree.releaseSnapshot`
     */
    export type ReleaseSnapshotRequest = {
      /**
       * The id of the layer snapshot.
       */
      snapshotId: SnapshotId;
    };
    /**
     * Releases layer snapshot captured by the back-end.
     * @response `LayerTree.releaseSnapshot`
     */
    export type ReleaseSnapshotResponse = {};
    /**
     * Replays the layer snapshot and returns the resulting bitmap.
     * @request `LayerTree.replaySnapshot`
     */
    export type ReplaySnapshotRequest = {
      /**
       * The id of the layer snapshot.
       */
      snapshotId: SnapshotId;
      /**
       * The first step to replay from (replay from the very start if not specified).
       */
      fromStep?: number | undefined;
      /**
       * The last step to replay to (replay till the end if not specified).
       */
      toStep?: number | undefined;
      /**
       * The scale to apply while replaying (defaults to 1).
       */
      scale?: number | undefined;
    };
    /**
     * Replays the layer snapshot and returns the resulting bitmap.
     * @response `LayerTree.replaySnapshot`
     */
    export type ReplaySnapshotResponse = {
      /**
       * A data: URL for resulting image.
       */
      dataURL: string;
    };
    /**
     * Replays the layer snapshot and returns canvas log.
     * @request `LayerTree.snapshotCommandLog`
     */
    export type SnapshotCommandLogRequest = {
      /**
       * The id of the layer snapshot.
       */
      snapshotId: SnapshotId;
    };
    /**
     * Replays the layer snapshot and returns canvas log.
     * @response `LayerTree.snapshotCommandLog`
     */
    export type SnapshotCommandLogResponse = {
      /**
       * The array of canvas function calls.
       */
      commandLog: Record<string, unknown>[];
    };
  }
  export namespace Log {
    /**
     * Log entry.
     */
    export type LogEntry = {
      /**
       * Log entry source.
       */
      source:
        | "xml"
        | "javascript"
        | "network"
        | "storage"
        | "appcache"
        | "rendering"
        | "security"
        | "deprecation"
        | "worker"
        | "violation"
        | "intervention"
        | "recommendation"
        | "other";
      /**
       * Log entry severity.
       */
      level: "verbose" | "info" | "warning" | "error";
      /**
       * Logged text.
       */
      text: string;
      category?: "cors" | undefined;
      /**
       * Timestamp when this entry was added.
       */
      timestamp: Runtime.Timestamp;
      /**
       * URL of the resource if known.
       */
      url?: string | undefined;
      /**
       * Line number in the resource.
       */
      lineNumber?: number | undefined;
      /**
       * JavaScript stack trace.
       */
      stackTrace?: Runtime.StackTrace | undefined;
      /**
       * Identifier of the network request associated with this entry.
       */
      networkRequestId?: Network.RequestId | undefined;
      /**
       * Identifier of the worker associated with this entry.
       */
      workerId?: string | undefined;
      /**
       * Call arguments.
       */
      args?: Runtime.RemoteObject[] | undefined;
    };
    /**
     * Violation configuration setting.
     */
    export type ViolationSetting = {
      /**
       * Violation type.
       */
      name:
        | "longTask"
        | "longLayout"
        | "blockedEvent"
        | "blockedParser"
        | "discouragedAPIUse"
        | "handler"
        | "recurringHandler";
      /**
       * Time threshold to trigger upon.
       */
      threshold: number;
    };
    /**
     * Issued when new message was logged.
     * @event `Log.entryAdded`
     */
    export type EntryAddedEvent = {
      /**
       * The entry.
       */
      entry: LogEntry;
    };
    /**
     * Clears the log.
     * @request `Log.clear`
     */
    export type ClearRequest = {};
    /**
     * Clears the log.
     * @response `Log.clear`
     */
    export type ClearResponse = {};
    /**
     * Disables log domain, prevents further log entries from being reported to the client.
     * @request `Log.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables log domain, prevents further log entries from being reported to the client.
     * @response `Log.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables log domain, sends the entries collected so far to the client by means of the
     * `entryAdded` notification.
     * @request `Log.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables log domain, sends the entries collected so far to the client by means of the
     * `entryAdded` notification.
     * @response `Log.enable`
     */
    export type EnableResponse = {};
    /**
     * start violation reporting.
     * @request `Log.startViolationsReport`
     */
    export type StartViolationsReportRequest = {
      /**
       * Configuration for violations.
       */
      config: ViolationSetting[];
    };
    /**
     * start violation reporting.
     * @response `Log.startViolationsReport`
     */
    export type StartViolationsReportResponse = {};
    /**
     * Stop violation reporting.
     * @request `Log.stopViolationsReport`
     */
    export type StopViolationsReportRequest = {};
    /**
     * Stop violation reporting.
     * @response `Log.stopViolationsReport`
     */
    export type StopViolationsReportResponse = {};
  }
  export namespace Media {
    /**
     * Players will get an ID that is unique within the agent context.
     */
    export type PlayerId = string;
    export type Timestamp = number;
    /**
     * Have one type per entry in MediaLogRecord::Type
     * Corresponds to kMessage
     */
    export type PlayerMessage = {
      /**
       * Keep in sync with MediaLogMessageLevel
       * We are currently keeping the message level 'error' separate from the
       * PlayerError type because right now they represent different things,
       * this one being a DVLOG(ERROR) style log message that gets printed
       * based on what log level is selected in the UI, and the other is a
       * representation of a media::PipelineStatus object. Soon however we're
       * going to be moving away from using PipelineStatus for errors and
       * introducing a new error type which should hopefully let us integrate
       * the error log level into the PlayerError type.
       */
      level: "error" | "warning" | "info" | "debug";
      message: string;
    };
    /**
     * Corresponds to kMediaPropertyChange
     */
    export type PlayerProperty = {
      name: string;
      value: string;
    };
    /**
     * Corresponds to kMediaEventTriggered
     */
    export type PlayerEvent = {
      timestamp: Timestamp;
      value: string;
    };
    /**
     * Represents logged source line numbers reported in an error.
     * NOTE: file and line are from chromium c++ implementation code, not js.
     */
    export type PlayerErrorSourceLocation = {
      file: string;
      line: number;
    };
    /**
     * Corresponds to kMediaError
     */
    export type PlayerError = {
      errorType: string;
      /**
       * Code is the numeric enum entry for a specific set of error codes, such
       * as PipelineStatusCodes in media/base/pipeline_status.h
       */
      code: number;
      /**
       * A trace of where this error was caused / where it passed through.
       */
      stack: PlayerErrorSourceLocation[];
      /**
       * Errors potentially have a root cause error, ie, a DecoderError might be
       * caused by an WindowsError
       */
      cause: PlayerError[];
      /**
       * Extra data attached to an error, such as an HRESULT, Video Codec, etc.
       */
      data: Record<string, unknown>;
    };
    /**
     * This can be called multiple times, and can be used to set / override /
     * remove player properties. A null propValue indicates removal.
     * @event `Media.playerPropertiesChanged`
     */
    export type PlayerPropertiesChangedEvent = {
      playerId: PlayerId;
      properties: PlayerProperty[];
    };
    /**
     * Send events as a list, allowing them to be batched on the browser for less
     * congestion. If batched, events must ALWAYS be in chronological order.
     * @event `Media.playerEventsAdded`
     */
    export type PlayerEventsAddedEvent = {
      playerId: PlayerId;
      events: PlayerEvent[];
    };
    /**
     * Send a list of any messages that need to be delivered.
     * @event `Media.playerMessagesLogged`
     */
    export type PlayerMessagesLoggedEvent = {
      playerId: PlayerId;
      messages: PlayerMessage[];
    };
    /**
     * Send a list of any errors that need to be delivered.
     * @event `Media.playerErrorsRaised`
     */
    export type PlayerErrorsRaisedEvent = {
      playerId: PlayerId;
      errors: PlayerError[];
    };
    /**
     * Called whenever a player is created, or when a new agent joins and receives
     * a list of active players. If an agent is restored, it will receive the full
     * list of player ids and all events again.
     * @event `Media.playersCreated`
     */
    export type PlayersCreatedEvent = {
      players: PlayerId[];
    };
    /**
     * Enables the Media domain
     * @request `Media.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables the Media domain
     * @response `Media.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables the Media domain.
     * @request `Media.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables the Media domain.
     * @response `Media.disable`
     */
    export type DisableResponse = {};
  }
  export namespace Overlay {
    /**
     * Configuration data for drawing the source order of an elements children.
     */
    export type SourceOrderConfig = {
      /**
       * the color to outline the givent element in.
       */
      parentOutlineColor: DOM.RGBA;
      /**
       * the color to outline the child elements in.
       */
      childOutlineColor: DOM.RGBA;
    };
    /**
     * Configuration data for the highlighting of Grid elements.
     */
    export type GridHighlightConfig = {
      /**
       * Whether the extension lines from grid cells to the rulers should be shown (default: false).
       */
      showGridExtensionLines?: boolean | undefined;
      /**
       * Show Positive line number labels (default: false).
       */
      showPositiveLineNumbers?: boolean | undefined;
      /**
       * Show Negative line number labels (default: false).
       */
      showNegativeLineNumbers?: boolean | undefined;
      /**
       * Show area name labels (default: false).
       */
      showAreaNames?: boolean | undefined;
      /**
       * Show line name labels (default: false).
       */
      showLineNames?: boolean | undefined;
      /**
       * Show track size labels (default: false).
       */
      showTrackSizes?: boolean | undefined;
      /**
       * The grid container border highlight color (default: transparent).
       */
      gridBorderColor?: DOM.RGBA | undefined;
      /**
       * The cell border color (default: transparent). Deprecated, please use rowLineColor and columnLineColor instead.
       */
      cellBorderColor?: DOM.RGBA | undefined;
      /**
       * The row line color (default: transparent).
       */
      rowLineColor?: DOM.RGBA | undefined;
      /**
       * The column line color (default: transparent).
       */
      columnLineColor?: DOM.RGBA | undefined;
      /**
       * Whether the grid border is dashed (default: false).
       */
      gridBorderDash?: boolean | undefined;
      /**
       * Whether the cell border is dashed (default: false). Deprecated, please us rowLineDash and columnLineDash instead.
       */
      cellBorderDash?: boolean | undefined;
      /**
       * Whether row lines are dashed (default: false).
       */
      rowLineDash?: boolean | undefined;
      /**
       * Whether column lines are dashed (default: false).
       */
      columnLineDash?: boolean | undefined;
      /**
       * The row gap highlight fill color (default: transparent).
       */
      rowGapColor?: DOM.RGBA | undefined;
      /**
       * The row gap hatching fill color (default: transparent).
       */
      rowHatchColor?: DOM.RGBA | undefined;
      /**
       * The column gap highlight fill color (default: transparent).
       */
      columnGapColor?: DOM.RGBA | undefined;
      /**
       * The column gap hatching fill color (default: transparent).
       */
      columnHatchColor?: DOM.RGBA | undefined;
      /**
       * The named grid areas border color (Default: transparent).
       */
      areaBorderColor?: DOM.RGBA | undefined;
      /**
       * The grid container background color (Default: transparent).
       */
      gridBackgroundColor?: DOM.RGBA | undefined;
    };
    /**
     * Configuration data for the highlighting of Flex container elements.
     */
    export type FlexContainerHighlightConfig = {
      /**
       * The style of the container border
       */
      containerBorder?: LineStyle | undefined;
      /**
       * The style of the separator between lines
       */
      lineSeparator?: LineStyle | undefined;
      /**
       * The style of the separator between items
       */
      itemSeparator?: LineStyle | undefined;
      /**
       * Style of content-distribution space on the main axis (justify-content).
       */
      mainDistributedSpace?: BoxStyle | undefined;
      /**
       * Style of content-distribution space on the cross axis (align-content).
       */
      crossDistributedSpace?: BoxStyle | undefined;
      /**
       * Style of empty space caused by row gaps (gap/row-gap).
       */
      rowGapSpace?: BoxStyle | undefined;
      /**
       * Style of empty space caused by columns gaps (gap/column-gap).
       */
      columnGapSpace?: BoxStyle | undefined;
      /**
       * Style of the self-alignment line (align-items).
       */
      crossAlignment?: LineStyle | undefined;
    };
    /**
     * Configuration data for the highlighting of Flex item elements.
     */
    export type FlexItemHighlightConfig = {
      /**
       * Style of the box representing the item's base size
       */
      baseSizeBox?: BoxStyle | undefined;
      /**
       * Style of the border around the box representing the item's base size
       */
      baseSizeBorder?: LineStyle | undefined;
      /**
       * Style of the arrow representing if the item grew or shrank
       */
      flexibilityArrow?: LineStyle | undefined;
    };
    /**
     * Style information for drawing a line.
     */
    export type LineStyle = {
      /**
       * The color of the line (default: transparent)
       */
      color?: DOM.RGBA | undefined;
      /**
       * The line pattern (default: solid)
       */
      pattern?: "dashed" | "dotted" | undefined;
    };
    /**
     * Style information for drawing a box.
     */
    export type BoxStyle = {
      /**
       * The background color for the box (default: transparent)
       */
      fillColor?: DOM.RGBA | undefined;
      /**
       * The hatching color for the box (default: transparent)
       */
      hatchColor?: DOM.RGBA | undefined;
    };
    export type ContrastAlgorithm = "aa" | "aaa" | "apca";
    /**
     * Configuration data for the highlighting of page elements.
     */
    export type HighlightConfig = {
      /**
       * Whether the node info tooltip should be shown (default: false).
       */
      showInfo?: boolean | undefined;
      /**
       * Whether the node styles in the tooltip (default: false).
       */
      showStyles?: boolean | undefined;
      /**
       * Whether the rulers should be shown (default: false).
       */
      showRulers?: boolean | undefined;
      /**
       * Whether the a11y info should be shown (default: true).
       */
      showAccessibilityInfo?: boolean | undefined;
      /**
       * Whether the extension lines from node to the rulers should be shown (default: false).
       */
      showExtensionLines?: boolean | undefined;
      /**
       * The content box highlight fill color (default: transparent).
       */
      contentColor?: DOM.RGBA | undefined;
      /**
       * The padding highlight fill color (default: transparent).
       */
      paddingColor?: DOM.RGBA | undefined;
      /**
       * The border highlight fill color (default: transparent).
       */
      borderColor?: DOM.RGBA | undefined;
      /**
       * The margin highlight fill color (default: transparent).
       */
      marginColor?: DOM.RGBA | undefined;
      /**
       * The event target element highlight fill color (default: transparent).
       */
      eventTargetColor?: DOM.RGBA | undefined;
      /**
       * The shape outside fill color (default: transparent).
       */
      shapeColor?: DOM.RGBA | undefined;
      /**
       * The shape margin fill color (default: transparent).
       */
      shapeMarginColor?: DOM.RGBA | undefined;
      /**
       * The grid layout color (default: transparent).
       */
      cssGridColor?: DOM.RGBA | undefined;
      /**
       * The color format used to format color styles (default: hex).
       */
      colorFormat?: ColorFormat | undefined;
      /**
       * The grid layout highlight configuration (default: all transparent).
       */
      gridHighlightConfig?: GridHighlightConfig | undefined;
      /**
       * The flex container highlight configuration (default: all transparent).
       */
      flexContainerHighlightConfig?: FlexContainerHighlightConfig | undefined;
      /**
       * The flex item highlight configuration (default: all transparent).
       */
      flexItemHighlightConfig?: FlexItemHighlightConfig | undefined;
      /**
       * The contrast algorithm to use for the contrast ratio (default: aa).
       */
      contrastAlgorithm?: ContrastAlgorithm | undefined;
      /**
       * The container query container highlight configuration (default: all transparent).
       */
      containerQueryContainerHighlightConfig?: ContainerQueryContainerHighlightConfig | undefined;
    };
    export type ColorFormat = "rgb" | "hsl" | "hwb" | "hex";
    /**
     * Configurations for Persistent Grid Highlight
     */
    export type GridNodeHighlightConfig = {
      /**
       * A descriptor for the highlight appearance.
       */
      gridHighlightConfig: GridHighlightConfig;
      /**
       * Identifier of the node to highlight.
       */
      nodeId: DOM.NodeId;
    };
    export type FlexNodeHighlightConfig = {
      /**
       * A descriptor for the highlight appearance of flex containers.
       */
      flexContainerHighlightConfig: FlexContainerHighlightConfig;
      /**
       * Identifier of the node to highlight.
       */
      nodeId: DOM.NodeId;
    };
    export type ScrollSnapContainerHighlightConfig = {
      /**
       * The style of the snapport border (default: transparent)
       */
      snapportBorder?: LineStyle | undefined;
      /**
       * The style of the snap area border (default: transparent)
       */
      snapAreaBorder?: LineStyle | undefined;
      /**
       * The margin highlight fill color (default: transparent).
       */
      scrollMarginColor?: DOM.RGBA | undefined;
      /**
       * The padding highlight fill color (default: transparent).
       */
      scrollPaddingColor?: DOM.RGBA | undefined;
    };
    export type ScrollSnapHighlightConfig = {
      /**
       * A descriptor for the highlight appearance of scroll snap containers.
       */
      scrollSnapContainerHighlightConfig: ScrollSnapContainerHighlightConfig;
      /**
       * Identifier of the node to highlight.
       */
      nodeId: DOM.NodeId;
    };
    /**
     * Configuration for dual screen hinge
     */
    export type HingeConfig = {
      /**
       * A rectangle represent hinge
       */
      rect: DOM.Rect;
      /**
       * The content box highlight fill color (default: a dark color).
       */
      contentColor?: DOM.RGBA | undefined;
      /**
       * The content box highlight outline color (default: transparent).
       */
      outlineColor?: DOM.RGBA | undefined;
    };
    /**
     * Configuration for Window Controls Overlay
     */
    export type WindowControlsOverlayConfig = {
      /**
       * Whether the title bar CSS should be shown when emulating the Window Controls Overlay.
       */
      showCSS: boolean;
      /**
       * Seleted platforms to show the overlay.
       */
      selectedPlatform: string;
      /**
       * The theme color defined in app manifest.
       */
      themeColor: string;
    };
    export type ContainerQueryHighlightConfig = {
      /**
       * A descriptor for the highlight appearance of container query containers.
       */
      containerQueryContainerHighlightConfig: ContainerQueryContainerHighlightConfig;
      /**
       * Identifier of the container node to highlight.
       */
      nodeId: DOM.NodeId;
    };
    export type ContainerQueryContainerHighlightConfig = {
      /**
       * The style of the container border.
       */
      containerBorder?: LineStyle | undefined;
      /**
       * The style of the descendants' borders.
       */
      descendantBorder?: LineStyle | undefined;
    };
    export type IsolatedElementHighlightConfig = {
      /**
       * A descriptor for the highlight appearance of an element in isolation mode.
       */
      isolationModeHighlightConfig: IsolationModeHighlightConfig;
      /**
       * Identifier of the isolated element to highlight.
       */
      nodeId: DOM.NodeId;
    };
    export type IsolationModeHighlightConfig = {
      /**
       * The fill color of the resizers (default: transparent).
       */
      resizerColor?: DOM.RGBA | undefined;
      /**
       * The fill color for resizer handles (default: transparent).
       */
      resizerHandleColor?: DOM.RGBA | undefined;
      /**
       * The fill color for the mask covering non-isolated elements (default: transparent).
       */
      maskColor?: DOM.RGBA | undefined;
    };
    export type InspectMode =
      | "searchForNode"
      | "searchForUAShadowDOM"
      | "captureAreaScreenshot"
      | "showDistances"
      | "none";
    /**
     * Fired when the node should be inspected. This happens after call to `setInspectMode` or when
     * user manually inspects an element.
     * @event `Overlay.inspectNodeRequested`
     */
    export type InspectNodeRequestedEvent = {
      /**
       * Id of the node to inspect.
       */
      backendNodeId: DOM.BackendNodeId;
    };
    /**
     * Fired when the node should be highlighted. This happens after call to `setInspectMode`.
     * @event `Overlay.nodeHighlightRequested`
     */
    export type NodeHighlightRequestedEvent = {
      nodeId: DOM.NodeId;
    };
    /**
     * Fired when user asks to capture screenshot of some area on the page.
     * @event `Overlay.screenshotRequested`
     */
    export type ScreenshotRequestedEvent = {
      /**
       * Viewport to capture, in device independent pixels (dip).
       */
      viewport: Page.Viewport;
    };
    /**
     * Fired when user cancels the inspect mode.
     * @event `Overlay.inspectModeCanceled`
     */
    export type InspectModeCanceledEvent = {};
    /**
     * Disables domain notifications.
     * @request `Overlay.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables domain notifications.
     * @response `Overlay.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables domain notifications.
     * @request `Overlay.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables domain notifications.
     * @response `Overlay.enable`
     */
    export type EnableResponse = {};
    /**
     * For testing.
     * @request `Overlay.getHighlightObjectForTest`
     */
    export type GetHighlightObjectForTestRequest = {
      /**
       * Id of the node to get highlight object for.
       */
      nodeId: DOM.NodeId;
      /**
       * Whether to include distance info.
       */
      includeDistance?: boolean | undefined;
      /**
       * Whether to include style info.
       */
      includeStyle?: boolean | undefined;
      /**
       * The color format to get config with (default: hex).
       */
      colorFormat?: ColorFormat | undefined;
      /**
       * Whether to show accessibility info (default: true).
       */
      showAccessibilityInfo?: boolean | undefined;
    };
    /**
     * For testing.
     * @response `Overlay.getHighlightObjectForTest`
     */
    export type GetHighlightObjectForTestResponse = {
      /**
       * Highlight data for the node.
       */
      highlight: Record<string, unknown>;
    };
    /**
     * For Persistent Grid testing.
     * @request `Overlay.getGridHighlightObjectsForTest`
     */
    export type GetGridHighlightObjectsForTestRequest = {
      /**
       * Ids of the node to get highlight object for.
       */
      nodeIds: DOM.NodeId[];
    };
    /**
     * For Persistent Grid testing.
     * @response `Overlay.getGridHighlightObjectsForTest`
     */
    export type GetGridHighlightObjectsForTestResponse = {
      /**
       * Grid Highlight data for the node ids provided.
       */
      highlights: Record<string, unknown>;
    };
    /**
     * For Source Order Viewer testing.
     * @request `Overlay.getSourceOrderHighlightObjectForTest`
     */
    export type GetSourceOrderHighlightObjectForTestRequest = {
      /**
       * Id of the node to highlight.
       */
      nodeId: DOM.NodeId;
    };
    /**
     * For Source Order Viewer testing.
     * @response `Overlay.getSourceOrderHighlightObjectForTest`
     */
    export type GetSourceOrderHighlightObjectForTestResponse = {
      /**
       * Source order highlight data for the node id provided.
       */
      highlight: Record<string, unknown>;
    };
    /**
     * Hides any highlight.
     * @request `Overlay.hideHighlight`
     */
    export type HideHighlightRequest = {};
    /**
     * Hides any highlight.
     * @response `Overlay.hideHighlight`
     */
    export type HideHighlightResponse = {};
    /**
     * Highlights owner element of the frame with given id.
     * Deprecated: Doesn't work reliablity and cannot be fixed due to process
     * separatation (the owner node might be in a different process). Determine
     * the owner node in the client and use highlightNode.
     * @request `Overlay.highlightFrame`
     */
    export type HighlightFrameRequest = {
      /**
       * Identifier of the frame to highlight.
       */
      frameId: Page.FrameId;
      /**
       * The content box highlight fill color (default: transparent).
       */
      contentColor?: DOM.RGBA | undefined;
      /**
       * The content box highlight outline color (default: transparent).
       */
      contentOutlineColor?: DOM.RGBA | undefined;
    };
    /**
     * Highlights owner element of the frame with given id.
     * Deprecated: Doesn't work reliablity and cannot be fixed due to process
     * separatation (the owner node might be in a different process). Determine
     * the owner node in the client and use highlightNode.
     * @response `Overlay.highlightFrame`
     */
    export type HighlightFrameResponse = {};
    /**
     * Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or
     * objectId must be specified.
     * @request `Overlay.highlightNode`
     */
    export type HighlightNodeRequest = {
      /**
       * A descriptor for the highlight appearance.
       */
      highlightConfig: HighlightConfig;
      /**
       * Identifier of the node to highlight.
       */
      nodeId?: DOM.NodeId | undefined;
      /**
       * Identifier of the backend node to highlight.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * JavaScript object id of the node to be highlighted.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
      /**
       * Selectors to highlight relevant nodes.
       */
      selector?: string | undefined;
    };
    /**
     * Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or
     * objectId must be specified.
     * @response `Overlay.highlightNode`
     */
    export type HighlightNodeResponse = {};
    /**
     * Highlights given quad. Coordinates are absolute with respect to the main frame viewport.
     * @request `Overlay.highlightQuad`
     */
    export type HighlightQuadRequest = {
      /**
       * Quad to highlight
       */
      quad: DOM.Quad;
      /**
       * The highlight fill color (default: transparent).
       */
      color?: DOM.RGBA | undefined;
      /**
       * The highlight outline color (default: transparent).
       */
      outlineColor?: DOM.RGBA | undefined;
    };
    /**
     * Highlights given quad. Coordinates are absolute with respect to the main frame viewport.
     * @response `Overlay.highlightQuad`
     */
    export type HighlightQuadResponse = {};
    /**
     * Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
     * @request `Overlay.highlightRect`
     */
    export type HighlightRectRequest = {
      /**
       * X coordinate
       */
      x: number;
      /**
       * Y coordinate
       */
      y: number;
      /**
       * Rectangle width
       */
      width: number;
      /**
       * Rectangle height
       */
      height: number;
      /**
       * The highlight fill color (default: transparent).
       */
      color?: DOM.RGBA | undefined;
      /**
       * The highlight outline color (default: transparent).
       */
      outlineColor?: DOM.RGBA | undefined;
    };
    /**
     * Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
     * @response `Overlay.highlightRect`
     */
    export type HighlightRectResponse = {};
    /**
     * Highlights the source order of the children of the DOM node with given id or with the given
     * JavaScript object wrapper. Either nodeId or objectId must be specified.
     * @request `Overlay.highlightSourceOrder`
     */
    export type HighlightSourceOrderRequest = {
      /**
       * A descriptor for the appearance of the overlay drawing.
       */
      sourceOrderConfig: SourceOrderConfig;
      /**
       * Identifier of the node to highlight.
       */
      nodeId?: DOM.NodeId | undefined;
      /**
       * Identifier of the backend node to highlight.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      /**
       * JavaScript object id of the node to be highlighted.
       */
      objectId?: Runtime.RemoteObjectId | undefined;
    };
    /**
     * Highlights the source order of the children of the DOM node with given id or with the given
     * JavaScript object wrapper. Either nodeId or objectId must be specified.
     * @response `Overlay.highlightSourceOrder`
     */
    export type HighlightSourceOrderResponse = {};
    /**
     * Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted.
     * Backend then generates 'inspectNodeRequested' event upon element selection.
     * @request `Overlay.setInspectMode`
     */
    export type SetInspectModeRequest = {
      /**
       * Set an inspection mode.
       */
      mode: InspectMode;
      /**
       * A descriptor for the highlight appearance of hovered-over nodes. May be omitted if `enabled
       * == false`.
       */
      highlightConfig?: HighlightConfig | undefined;
    };
    /**
     * Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted.
     * Backend then generates 'inspectNodeRequested' event upon element selection.
     * @response `Overlay.setInspectMode`
     */
    export type SetInspectModeResponse = {};
    /**
     * Highlights owner element of all frames detected to be ads.
     * @request `Overlay.setShowAdHighlights`
     */
    export type SetShowAdHighlightsRequest = {
      /**
       * True for showing ad highlights
       */
      show: boolean;
    };
    /**
     * Highlights owner element of all frames detected to be ads.
     * @response `Overlay.setShowAdHighlights`
     */
    export type SetShowAdHighlightsResponse = {};
    /**
     * undefined
     * @request `Overlay.setPausedInDebuggerMessage`
     */
    export type SetPausedInDebuggerMessageRequest = {
      /**
       * The message to display, also triggers resume and step over controls.
       */
      message?: string | undefined;
    };
    /**
     * undefined
     * @response `Overlay.setPausedInDebuggerMessage`
     */
    export type SetPausedInDebuggerMessageResponse = {};
    /**
     * Requests that backend shows debug borders on layers
     * @request `Overlay.setShowDebugBorders`
     */
    export type SetShowDebugBordersRequest = {
      /**
       * True for showing debug borders
       */
      show: boolean;
    };
    /**
     * Requests that backend shows debug borders on layers
     * @response `Overlay.setShowDebugBorders`
     */
    export type SetShowDebugBordersResponse = {};
    /**
     * Requests that backend shows the FPS counter
     * @request `Overlay.setShowFPSCounter`
     */
    export type SetShowFPSCounterRequest = {
      /**
       * True for showing the FPS counter
       */
      show: boolean;
    };
    /**
     * Requests that backend shows the FPS counter
     * @response `Overlay.setShowFPSCounter`
     */
    export type SetShowFPSCounterResponse = {};
    /**
     * Highlight multiple elements with the CSS Grid overlay.
     * @request `Overlay.setShowGridOverlays`
     */
    export type SetShowGridOverlaysRequest = {
      /**
       * An array of node identifiers and descriptors for the highlight appearance.
       */
      gridNodeHighlightConfigs: GridNodeHighlightConfig[];
    };
    /**
     * Highlight multiple elements with the CSS Grid overlay.
     * @response `Overlay.setShowGridOverlays`
     */
    export type SetShowGridOverlaysResponse = {};
    /**
     * undefined
     * @request `Overlay.setShowFlexOverlays`
     */
    export type SetShowFlexOverlaysRequest = {
      /**
       * An array of node identifiers and descriptors for the highlight appearance.
       */
      flexNodeHighlightConfigs: FlexNodeHighlightConfig[];
    };
    /**
     * undefined
     * @response `Overlay.setShowFlexOverlays`
     */
    export type SetShowFlexOverlaysResponse = {};
    /**
     * undefined
     * @request `Overlay.setShowScrollSnapOverlays`
     */
    export type SetShowScrollSnapOverlaysRequest = {
      /**
       * An array of node identifiers and descriptors for the highlight appearance.
       */
      scrollSnapHighlightConfigs: ScrollSnapHighlightConfig[];
    };
    /**
     * undefined
     * @response `Overlay.setShowScrollSnapOverlays`
     */
    export type SetShowScrollSnapOverlaysResponse = {};
    /**
     * undefined
     * @request `Overlay.setShowContainerQueryOverlays`
     */
    export type SetShowContainerQueryOverlaysRequest = {
      /**
       * An array of node identifiers and descriptors for the highlight appearance.
       */
      containerQueryHighlightConfigs: ContainerQueryHighlightConfig[];
    };
    /**
     * undefined
     * @response `Overlay.setShowContainerQueryOverlays`
     */
    export type SetShowContainerQueryOverlaysResponse = {};
    /**
     * Requests that backend shows paint rectangles
     * @request `Overlay.setShowPaintRects`
     */
    export type SetShowPaintRectsRequest = {
      /**
       * True for showing paint rectangles
       */
      result: boolean;
    };
    /**
     * Requests that backend shows paint rectangles
     * @response `Overlay.setShowPaintRects`
     */
    export type SetShowPaintRectsResponse = {};
    /**
     * Requests that backend shows layout shift regions
     * @request `Overlay.setShowLayoutShiftRegions`
     */
    export type SetShowLayoutShiftRegionsRequest = {
      /**
       * True for showing layout shift regions
       */
      result: boolean;
    };
    /**
     * Requests that backend shows layout shift regions
     * @response `Overlay.setShowLayoutShiftRegions`
     */
    export type SetShowLayoutShiftRegionsResponse = {};
    /**
     * Requests that backend shows scroll bottleneck rects
     * @request `Overlay.setShowScrollBottleneckRects`
     */
    export type SetShowScrollBottleneckRectsRequest = {
      /**
       * True for showing scroll bottleneck rects
       */
      show: boolean;
    };
    /**
     * Requests that backend shows scroll bottleneck rects
     * @response `Overlay.setShowScrollBottleneckRects`
     */
    export type SetShowScrollBottleneckRectsResponse = {};
    /**
     * Deprecated, no longer has any effect.
     * @request `Overlay.setShowHitTestBorders`
     */
    export type SetShowHitTestBordersRequest = {
      /**
       * True for showing hit-test borders
       */
      show: boolean;
    };
    /**
     * Deprecated, no longer has any effect.
     * @response `Overlay.setShowHitTestBorders`
     */
    export type SetShowHitTestBordersResponse = {};
    /**
     * Request that backend shows an overlay with web vital metrics.
     * @request `Overlay.setShowWebVitals`
     */
    export type SetShowWebVitalsRequest = {
      show: boolean;
    };
    /**
     * Request that backend shows an overlay with web vital metrics.
     * @response `Overlay.setShowWebVitals`
     */
    export type SetShowWebVitalsResponse = {};
    /**
     * Paints viewport size upon main frame resize.
     * @request `Overlay.setShowViewportSizeOnResize`
     */
    export type SetShowViewportSizeOnResizeRequest = {
      /**
       * Whether to paint size or not.
       */
      show: boolean;
    };
    /**
     * Paints viewport size upon main frame resize.
     * @response `Overlay.setShowViewportSizeOnResize`
     */
    export type SetShowViewportSizeOnResizeResponse = {};
    /**
     * Add a dual screen device hinge
     * @request `Overlay.setShowHinge`
     */
    export type SetShowHingeRequest = {
      /**
       * hinge data, null means hideHinge
       */
      hingeConfig?: HingeConfig | undefined;
    };
    /**
     * Add a dual screen device hinge
     * @response `Overlay.setShowHinge`
     */
    export type SetShowHingeResponse = {};
    /**
     * Show elements in isolation mode with overlays.
     * @request `Overlay.setShowIsolatedElements`
     */
    export type SetShowIsolatedElementsRequest = {
      /**
       * An array of node identifiers and descriptors for the highlight appearance.
       */
      isolatedElementHighlightConfigs: IsolatedElementHighlightConfig[];
    };
    /**
     * Show elements in isolation mode with overlays.
     * @response `Overlay.setShowIsolatedElements`
     */
    export type SetShowIsolatedElementsResponse = {};
    /**
     * Show Window Controls Overlay for PWA
     * @request `Overlay.setShowWindowControlsOverlay`
     */
    export type SetShowWindowControlsOverlayRequest = {
      /**
       * Window Controls Overlay data, null means hide Window Controls Overlay
       */
      windowControlsOverlayConfig?: WindowControlsOverlayConfig | undefined;
    };
    /**
     * Show Window Controls Overlay for PWA
     * @response `Overlay.setShowWindowControlsOverlay`
     */
    export type SetShowWindowControlsOverlayResponse = {};
  }
  export namespace Page {
    /**
     * Unique frame identifier.
     */
    export type FrameId = string;
    /**
     * Indicates whether a frame has been identified as an ad.
     */
    export type AdFrameType = "none" | "child" | "root";
    export type AdFrameExplanation = "ParentIsAd" | "CreatedByAdScript" | "MatchedBlockingRule";
    /**
     * Indicates whether a frame has been identified as an ad and why.
     */
    export type AdFrameStatus = {
      adFrameType: AdFrameType;
      explanations?: AdFrameExplanation[] | undefined;
    };
    /**
     * Identifies the bottom-most script which caused the frame to be labelled
     * as an ad.
     */
    export type AdScriptId = {
      /**
       * Script Id of the bottom-most script which caused the frame to be labelled
       * as an ad.
       */
      scriptId: Runtime.ScriptId;
      /**
       * Id of adScriptId's debugger.
       */
      debuggerId: Runtime.UniqueDebuggerId;
    };
    /**
     * Indicates whether the frame is a secure context and why it is the case.
     */
    export type SecureContextType = "Secure" | "SecureLocalhost" | "InsecureScheme" | "InsecureAncestor";
    /**
     * Indicates whether the frame is cross-origin isolated and why it is the case.
     */
    export type CrossOriginIsolatedContextType = "Isolated" | "NotIsolated" | "NotIsolatedFeatureDisabled";
    export type GatedAPIFeatures =
      | "SharedArrayBuffers"
      | "SharedArrayBuffersTransferAllowed"
      | "PerformanceMeasureMemory"
      | "PerformanceProfile";
    /**
     * All Permissions Policy features. This enum should match the one defined
     * in third_party/blink/renderer/core/permissions_policy/permissions_policy_features.json5.
     */
    export type PermissionsPolicyFeature =
      | "accelerometer"
      | "ambient-light-sensor"
      | "attribution-reporting"
      | "autoplay"
      | "bluetooth"
      | "browsing-topics"
      | "camera"
      | "captured-surface-control"
      | "ch-dpr"
      | "ch-device-memory"
      | "ch-downlink"
      | "ch-ect"
      | "ch-prefers-color-scheme"
      | "ch-prefers-reduced-motion"
      | "ch-prefers-reduced-transparency"
      | "ch-rtt"
      | "ch-save-data"
      | "ch-ua"
      | "ch-ua-arch"
      | "ch-ua-bitness"
      | "ch-ua-platform"
      | "ch-ua-model"
      | "ch-ua-mobile"
      | "ch-ua-form-factor"
      | "ch-ua-full-version"
      | "ch-ua-full-version-list"
      | "ch-ua-platform-version"
      | "ch-ua-wow64"
      | "ch-viewport-height"
      | "ch-viewport-width"
      | "ch-width"
      | "clipboard-read"
      | "clipboard-write"
      | "compute-pressure"
      | "cross-origin-isolated"
      | "direct-sockets"
      | "display-capture"
      | "document-domain"
      | "encrypted-media"
      | "execution-while-out-of-viewport"
      | "execution-while-not-rendered"
      | "focus-without-user-activation"
      | "fullscreen"
      | "frobulate"
      | "gamepad"
      | "geolocation"
      | "gyroscope"
      | "hid"
      | "identity-credentials-get"
      | "idle-detection"
      | "interest-cohort"
      | "join-ad-interest-group"
      | "keyboard-map"
      | "local-fonts"
      | "magnetometer"
      | "microphone"
      | "midi"
      | "otp-credentials"
      | "payment"
      | "picture-in-picture"
      | "private-aggregation"
      | "private-state-token-issuance"
      | "private-state-token-redemption"
      | "publickey-credentials-create"
      | "publickey-credentials-get"
      | "run-ad-auction"
      | "screen-wake-lock"
      | "serial"
      | "shared-autofill"
      | "shared-storage"
      | "shared-storage-select-url"
      | "smart-card"
      | "storage-access"
      | "sub-apps"
      | "sync-xhr"
      | "unload"
      | "usb"
      | "usb-unrestricted"
      | "vertical-scroll"
      | "web-printing"
      | "web-share"
      | "window-management"
      | "window-placement"
      | "xr-spatial-tracking";
    /**
     * Reason for a permissions policy feature to be disabled.
     */
    export type PermissionsPolicyBlockReason = "Header" | "IframeAttribute" | "InFencedFrameTree" | "InIsolatedApp";
    export type PermissionsPolicyBlockLocator = {
      frameId: FrameId;
      blockReason: PermissionsPolicyBlockReason;
    };
    export type PermissionsPolicyFeatureState = {
      feature: PermissionsPolicyFeature;
      allowed: boolean;
      locator?: PermissionsPolicyBlockLocator | undefined;
    };
    /**
     * Origin Trial(https://www.chromium.org/blink/origin-trials) support.
     * Status for an Origin Trial token.
     */
    export type OriginTrialTokenStatus =
      | "Success"
      | "NotSupported"
      | "Insecure"
      | "Expired"
      | "WrongOrigin"
      | "InvalidSignature"
      | "Malformed"
      | "WrongVersion"
      | "FeatureDisabled"
      | "TokenDisabled"
      | "FeatureDisabledForUser"
      | "UnknownTrial";
    /**
     * Status for an Origin Trial.
     */
    export type OriginTrialStatus = "Enabled" | "ValidTokenNotProvided" | "OSNotSupported" | "TrialNotAllowed";
    export type OriginTrialUsageRestriction = "None" | "Subset";
    export type OriginTrialToken = {
      origin: string;
      matchSubDomains: boolean;
      trialName: string;
      expiryTime: Network.TimeSinceEpoch;
      isThirdParty: boolean;
      usageRestriction: OriginTrialUsageRestriction;
    };
    export type OriginTrialTokenWithStatus = {
      rawTokenText: string;
      /**
       * `parsedToken` is present only when the token is extractable and
       * parsable.
       */
      parsedToken?: OriginTrialToken | undefined;
      status: OriginTrialTokenStatus;
    };
    export type OriginTrial = {
      trialName: string;
      status: OriginTrialStatus;
      tokensWithStatus: OriginTrialTokenWithStatus[];
    };
    /**
     * Information about the Frame on the page.
     */
    export type Frame = {
      /**
       * Frame unique identifier.
       */
      id: FrameId;
      /**
       * Parent frame identifier.
       */
      parentId?: FrameId | undefined;
      /**
       * Identifier of the loader associated with this frame.
       */
      loaderId: Network.LoaderId;
      /**
       * Frame's name as specified in the tag.
       */
      name?: string | undefined;
      /**
       * Frame document's URL without fragment.
       */
      url: string;
      /**
       * Frame document's URL fragment including the '#'.
       */
      urlFragment?: string | undefined;
      /**
       * Frame document's registered domain, taking the public suffixes list into account.
       * Extracted from the Frame's url.
       * Example URLs: http://www.google.com/file.html -> "google.com"
       * http://a.b.co.uk/file.html      -> "b.co.uk"
       */
      domainAndRegistry: string;
      /**
       * Frame document's security origin.
       */
      securityOrigin: string;
      /**
       * Frame document's mimeType as determined by the browser.
       */
      mimeType: string;
      /**
       * If the frame failed to load, this contains the URL that could not be loaded. Note that unlike url above, this URL may contain a fragment.
       */
      unreachableUrl?: string | undefined;
      /**
       * Indicates whether this frame was tagged as an ad and why.
       */
      adFrameStatus?: AdFrameStatus | undefined;
      /**
       * Indicates whether the main document is a secure context and explains why that is the case.
       */
      secureContextType: SecureContextType;
      /**
       * Indicates whether this is a cross origin isolated context.
       */
      crossOriginIsolatedContextType: CrossOriginIsolatedContextType;
      /**
       * Indicated which gated APIs / features are available.
       */
      gatedAPIFeatures: GatedAPIFeatures[];
    };
    /**
     * Information about the Resource on the page.
     */
    export type FrameResource = {
      /**
       * Resource URL.
       */
      url: string;
      /**
       * Type of this resource.
       */
      type: Network.ResourceType;
      /**
       * Resource mimeType as determined by the browser.
       */
      mimeType: string;
      /**
       * last-modified timestamp as reported by server.
       */
      lastModified?: Network.TimeSinceEpoch | undefined;
      /**
       * Resource content size.
       */
      contentSize?: number | undefined;
      /**
       * True if the resource failed to load.
       */
      failed?: boolean | undefined;
      /**
       * True if the resource was canceled during loading.
       */
      canceled?: boolean | undefined;
    };
    /**
     * Information about the Frame hierarchy along with their cached resources.
     */
    export type FrameResourceTree = {
      /**
       * Frame information for this tree item.
       */
      frame: Frame;
      /**
       * Child frames.
       */
      childFrames?: FrameResourceTree[] | undefined;
      /**
       * Information about frame resources.
       */
      resources: FrameResource[];
    };
    /**
     * Information about the Frame hierarchy.
     */
    export type FrameTree = {
      /**
       * Frame information for this tree item.
       */
      frame: Frame;
      /**
       * Child frames.
       */
      childFrames?: FrameTree[] | undefined;
    };
    /**
     * Unique script identifier.
     */
    export type ScriptIdentifier = string;
    /**
     * Transition type.
     */
    export type TransitionType =
      | "link"
      | "typed"
      | "address_bar"
      | "auto_bookmark"
      | "auto_subframe"
      | "manual_subframe"
      | "generated"
      | "auto_toplevel"
      | "form_submit"
      | "reload"
      | "keyword"
      | "keyword_generated"
      | "other";
    /**
     * Navigation history entry.
     */
    export type NavigationEntry = {
      /**
       * Unique id of the navigation history entry.
       */
      id: number;
      /**
       * URL of the navigation history entry.
       */
      url: string;
      /**
       * URL that the user typed in the url bar.
       */
      userTypedURL: string;
      /**
       * Title of the navigation history entry.
       */
      title: string;
      /**
       * Transition type.
       */
      transitionType: TransitionType;
    };
    /**
     * Screencast frame metadata.
     */
    export type ScreencastFrameMetadata = {
      /**
       * Top offset in DIP.
       */
      offsetTop: number;
      /**
       * Page scale factor.
       */
      pageScaleFactor: number;
      /**
       * Device screen width in DIP.
       */
      deviceWidth: number;
      /**
       * Device screen height in DIP.
       */
      deviceHeight: number;
      /**
       * Position of horizontal scroll in CSS pixels.
       */
      scrollOffsetX: number;
      /**
       * Position of vertical scroll in CSS pixels.
       */
      scrollOffsetY: number;
      /**
       * Frame swap timestamp.
       */
      timestamp?: Network.TimeSinceEpoch | undefined;
    };
    /**
     * Javascript dialog type.
     */
    export type DialogType = "alert" | "confirm" | "prompt" | "beforeunload";
    /**
     * Error while paring app manifest.
     */
    export type AppManifestError = {
      /**
       * Error message.
       */
      message: string;
      /**
       * If criticial, this is a non-recoverable parse error.
       */
      critical: number;
      /**
       * Error line.
       */
      line: number;
      /**
       * Error column.
       */
      column: number;
    };
    /**
     * Parsed app manifest properties.
     */
    export type AppManifestParsedProperties = {
      /**
       * Computed scope value
       */
      scope: string;
    };
    /**
     * Layout viewport position and dimensions.
     */
    export type LayoutViewport = {
      /**
       * Horizontal offset relative to the document (CSS pixels).
       */
      pageX: number;
      /**
       * Vertical offset relative to the document (CSS pixels).
       */
      pageY: number;
      /**
       * Width (CSS pixels), excludes scrollbar if present.
       */
      clientWidth: number;
      /**
       * Height (CSS pixels), excludes scrollbar if present.
       */
      clientHeight: number;
    };
    /**
     * Visual viewport position, dimensions, and scale.
     */
    export type VisualViewport = {
      /**
       * Horizontal offset relative to the layout viewport (CSS pixels).
       */
      offsetX: number;
      /**
       * Vertical offset relative to the layout viewport (CSS pixels).
       */
      offsetY: number;
      /**
       * Horizontal offset relative to the document (CSS pixels).
       */
      pageX: number;
      /**
       * Vertical offset relative to the document (CSS pixels).
       */
      pageY: number;
      /**
       * Width (CSS pixels), excludes scrollbar if present.
       */
      clientWidth: number;
      /**
       * Height (CSS pixels), excludes scrollbar if present.
       */
      clientHeight: number;
      /**
       * Scale relative to the ideal viewport (size at width=device-width).
       */
      scale: number;
      /**
       * Page zoom factor (CSS to device independent pixels ratio).
       */
      zoom?: number | undefined;
    };
    /**
     * Viewport for capturing screenshot.
     */
    export type Viewport = {
      /**
       * X offset in device independent pixels (dip).
       */
      x: number;
      /**
       * Y offset in device independent pixels (dip).
       */
      y: number;
      /**
       * Rectangle width in device independent pixels (dip).
       */
      width: number;
      /**
       * Rectangle height in device independent pixels (dip).
       */
      height: number;
      /**
       * Page scale factor.
       */
      scale: number;
    };
    /**
     * Generic font families collection.
     */
    export type FontFamilies = {
      /**
       * The standard font-family.
       */
      standard?: string | undefined;
      /**
       * The fixed font-family.
       */
      fixed?: string | undefined;
      /**
       * The serif font-family.
       */
      serif?: string | undefined;
      /**
       * The sansSerif font-family.
       */
      sansSerif?: string | undefined;
      /**
       * The cursive font-family.
       */
      cursive?: string | undefined;
      /**
       * The fantasy font-family.
       */
      fantasy?: string | undefined;
      /**
       * The math font-family.
       */
      math?: string | undefined;
    };
    /**
     * Font families collection for a script.
     */
    export type ScriptFontFamilies = {
      /**
       * Name of the script which these font families are defined for.
       */
      script: string;
      /**
       * Generic font families collection for the script.
       */
      fontFamilies: FontFamilies;
    };
    /**
     * Default font sizes.
     */
    export type FontSizes = {
      /**
       * Default standard font size.
       */
      standard?: number | undefined;
      /**
       * Default fixed font size.
       */
      fixed?: number | undefined;
    };
    export type ClientNavigationReason =
      | "formSubmissionGet"
      | "formSubmissionPost"
      | "httpHeaderRefresh"
      | "scriptInitiated"
      | "metaTagRefresh"
      | "pageBlockInterstitial"
      | "reload"
      | "anchorClick";
    export type ClientNavigationDisposition = "currentTab" | "newTab" | "newWindow" | "download";
    export type InstallabilityErrorArgument = {
      /**
       * Argument name (e.g. name:'minimum-icon-size-in-pixels').
       */
      name: string;
      /**
       * Argument value (e.g. value:'64').
       */
      value: string;
    };
    /**
     * The installability error
     */
    export type InstallabilityError = {
      /**
       * The error id (e.g. 'manifest-missing-suitable-icon').
       */
      errorId: string;
      /**
       * The list of error arguments (e.g. {name:'minimum-icon-size-in-pixels', value:'64'}).
       */
      errorArguments: InstallabilityErrorArgument[];
    };
    /**
     * The referring-policy used for the navigation.
     */
    export type ReferrerPolicy =
      | "noReferrer"
      | "noReferrerWhenDowngrade"
      | "origin"
      | "originWhenCrossOrigin"
      | "sameOrigin"
      | "strictOrigin"
      | "strictOriginWhenCrossOrigin"
      | "unsafeUrl";
    /**
     * Per-script compilation cache parameters for `Page.produceCompilationCache`
     */
    export type CompilationCacheParams = {
      /**
       * The URL of the script to produce a compilation cache entry for.
       */
      url: string;
      /**
       * A hint to the backend whether eager compilation is recommended.
       * (the actual compilation mode used is upon backend discretion).
       */
      eager?: boolean | undefined;
    };
    /**
     * Enum of possible auto-reponse for permisison / prompt dialogs.
     */
    export type AutoResponseMode = "none" | "autoAccept" | "autoReject" | "autoOptOut";
    /**
     * The type of a frameNavigated event.
     */
    export type NavigationType = "Navigation" | "BackForwardCacheRestore";
    /**
     * List of not restored reasons for back-forward cache.
     */
    export type BackForwardCacheNotRestoredReason =
      | "NotPrimaryMainFrame"
      | "BackForwardCacheDisabled"
      | "RelatedActiveContentsExist"
      | "HTTPStatusNotOK"
      | "SchemeNotHTTPOrHTTPS"
      | "Loading"
      | "WasGrantedMediaAccess"
      | "DisableForRenderFrameHostCalled"
      | "DomainNotAllowed"
      | "HTTPMethodNotGET"
      | "SubframeIsNavigating"
      | "Timeout"
      | "CacheLimit"
      | "JavaScriptExecution"
      | "RendererProcessKilled"
      | "RendererProcessCrashed"
      | "SchedulerTrackedFeatureUsed"
      | "ConflictingBrowsingInstance"
      | "CacheFlushed"
      | "ServiceWorkerVersionActivation"
      | "SessionRestored"
      | "ServiceWorkerPostMessage"
      | "EnteredBackForwardCacheBeforeServiceWorkerHostAdded"
      | "RenderFrameHostReused_SameSite"
      | "RenderFrameHostReused_CrossSite"
      | "ServiceWorkerClaim"
      | "IgnoreEventAndEvict"
      | "HaveInnerContents"
      | "TimeoutPuttingInCache"
      | "BackForwardCacheDisabledByLowMemory"
      | "BackForwardCacheDisabledByCommandLine"
      | "NetworkRequestDatapipeDrainedAsBytesConsumer"
      | "NetworkRequestRedirected"
      | "NetworkRequestTimeout"
      | "NetworkExceedsBufferLimit"
      | "NavigationCancelledWhileRestoring"
      | "NotMostRecentNavigationEntry"
      | "BackForwardCacheDisabledForPrerender"
      | "UserAgentOverrideDiffers"
      | "ForegroundCacheLimit"
      | "BrowsingInstanceNotSwapped"
      | "BackForwardCacheDisabledForDelegate"
      | "UnloadHandlerExistsInMainFrame"
      | "UnloadHandlerExistsInSubFrame"
      | "ServiceWorkerUnregistration"
      | "CacheControlNoStore"
      | "CacheControlNoStoreCookieModified"
      | "CacheControlNoStoreHTTPOnlyCookieModified"
      | "NoResponseHead"
      | "Unknown"
      | "ActivationNavigationsDisallowedForBug1234857"
      | "ErrorDocument"
      | "FencedFramesEmbedder"
      | "CookieDisabled"
      | "HTTPAuthRequired"
      | "CookieFlushed"
      | "WebSocket"
      | "WebTransport"
      | "WebRTC"
      | "MainResourceHasCacheControlNoStore"
      | "MainResourceHasCacheControlNoCache"
      | "SubresourceHasCacheControlNoStore"
      | "SubresourceHasCacheControlNoCache"
      | "ContainsPlugins"
      | "DocumentLoaded"
      | "DedicatedWorkerOrWorklet"
      | "OutstandingNetworkRequestOthers"
      | "RequestedMIDIPermission"
      | "RequestedAudioCapturePermission"
      | "RequestedVideoCapturePermission"
      | "RequestedBackForwardCacheBlockedSensors"
      | "RequestedBackgroundWorkPermission"
      | "BroadcastChannel"
      | "WebXR"
      | "SharedWorker"
      | "WebLocks"
      | "WebHID"
      | "WebShare"
      | "RequestedStorageAccessGrant"
      | "WebNfc"
      | "OutstandingNetworkRequestFetch"
      | "OutstandingNetworkRequestXHR"
      | "AppBanner"
      | "Printing"
      | "WebDatabase"
      | "PictureInPicture"
      | "Portal"
      | "SpeechRecognizer"
      | "IdleManager"
      | "PaymentManager"
      | "SpeechSynthesis"
      | "KeyboardLock"
      | "WebOTPService"
      | "OutstandingNetworkRequestDirectSocket"
      | "InjectedJavascript"
      | "InjectedStyleSheet"
      | "KeepaliveRequest"
      | "IndexedDBEvent"
      | "Dummy"
      | "JsNetworkRequestReceivedCacheControlNoStoreResource"
      | "WebRTCSticky"
      | "WebTransportSticky"
      | "WebSocketSticky"
      | "SmartCard"
      | "LiveMediaStreamTrack"
      | "UnloadHandler"
      | "ContentSecurityHandler"
      | "ContentWebAuthenticationAPI"
      | "ContentFileChooser"
      | "ContentSerial"
      | "ContentFileSystemAccess"
      | "ContentMediaDevicesDispatcherHost"
      | "ContentWebBluetooth"
      | "ContentWebUSB"
      | "ContentMediaSessionService"
      | "ContentScreenReader"
      | "EmbedderPopupBlockerTabHelper"
      | "EmbedderSafeBrowsingTriggeredPopupBlocker"
      | "EmbedderSafeBrowsingThreatDetails"
      | "EmbedderAppBannerManager"
      | "EmbedderDomDistillerViewerSource"
      | "EmbedderDomDistillerSelfDeletingRequestDelegate"
      | "EmbedderOomInterventionTabHelper"
      | "EmbedderOfflinePage"
      | "EmbedderChromePasswordManagerClientBindCredentialManager"
      | "EmbedderPermissionRequestManager"
      | "EmbedderModalDialog"
      | "EmbedderExtensions"
      | "EmbedderExtensionMessaging"
      | "EmbedderExtensionMessagingForOpenPort"
      | "EmbedderExtensionSentMessageToCachedFrame";
    /**
     * Types of not restored reasons for back-forward cache.
     */
    export type BackForwardCacheNotRestoredReasonType = "SupportPending" | "PageSupportNeeded" | "Circumstantial";
    export type BackForwardCacheBlockingDetails = {
      /**
       * Url of the file where blockage happened. Optional because of tests.
       */
      url?: string | undefined;
      /**
       * Function name where blockage happened. Optional because of anonymous functions and tests.
       */
      function?: string | undefined;
      /**
       * Line number in the script (0-based).
       */
      lineNumber: number;
      /**
       * Column number in the script (0-based).
       */
      columnNumber: number;
    };
    export type BackForwardCacheNotRestoredExplanation = {
      /**
       * Type of the reason
       */
      type: BackForwardCacheNotRestoredReasonType;
      /**
       * Not restored reason
       */
      reason: BackForwardCacheNotRestoredReason;
      /**
       * Context associated with the reason. The meaning of this context is
       * dependent on the reason:
       * - EmbedderExtensionSentMessageToCachedFrame: the extension ID.
       */
      context?: string | undefined;
      details?: BackForwardCacheBlockingDetails[] | undefined;
    };
    export type BackForwardCacheNotRestoredExplanationTree = {
      /**
       * URL of each frame
       */
      url: string;
      /**
       * Not restored reasons of each frame
       */
      explanations: BackForwardCacheNotRestoredExplanation[];
      /**
       * Array of children frame
       */
      children: BackForwardCacheNotRestoredExplanationTree[];
    };
    /**
     * undefined
     * @event `Page.domContentEventFired`
     */
    export type DomContentEventFiredEvent = {
      timestamp: Network.MonotonicTime;
    };
    /**
     * Emitted only when `page.interceptFileChooser` is enabled.
     * @event `Page.fileChooserOpened`
     */
    export type FileChooserOpenedEvent = {
      /**
       * Id of the frame containing input node.
       */
      frameId: FrameId;
      /**
       * Input mode.
       */
      mode: "selectSingle" | "selectMultiple";
      /**
       * Input node id. Only present for file choosers opened via an `<input type="file">` element.
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
    };
    /**
     * Fired when frame has been attached to its parent.
     * @event `Page.frameAttached`
     */
    export type FrameAttachedEvent = {
      /**
       * Id of the frame that has been attached.
       */
      frameId: FrameId;
      /**
       * Parent frame identifier.
       */
      parentFrameId: FrameId;
      /**
       * JavaScript stack trace of when frame was attached, only set if frame initiated from script.
       */
      stack?: Runtime.StackTrace | undefined;
    };
    /**
     * Fired when frame no longer has a scheduled navigation.
     * @event `Page.frameClearedScheduledNavigation`
     */
    export type FrameClearedScheduledNavigationEvent = {
      /**
       * Id of the frame that has cleared its scheduled navigation.
       */
      frameId: FrameId;
    };
    /**
     * Fired when frame has been detached from its parent.
     * @event `Page.frameDetached`
     */
    export type FrameDetachedEvent = {
      /**
       * Id of the frame that has been detached.
       */
      frameId: FrameId;
      reason: "remove" | "swap";
    };
    /**
     * Fired once navigation of the frame has completed. Frame is now associated with the new loader.
     * @event `Page.frameNavigated`
     */
    export type FrameNavigatedEvent = {
      /**
       * Frame object.
       */
      frame: Frame;
      type: NavigationType;
    };
    /**
     * Fired when opening document to write to.
     * @event `Page.documentOpened`
     */
    export type DocumentOpenedEvent = {
      /**
       * Frame object.
       */
      frame: Frame;
    };
    /**
     * undefined
     * @event `Page.frameResized`
     */
    export type FrameResizedEvent = {};
    /**
     * Fired when a renderer-initiated navigation is requested.
     * Navigation may still be cancelled after the event is issued.
     * @event `Page.frameRequestedNavigation`
     */
    export type FrameRequestedNavigationEvent = {
      /**
       * Id of the frame that is being navigated.
       */
      frameId: FrameId;
      /**
       * The reason for the navigation.
       */
      reason: ClientNavigationReason;
      /**
       * The destination URL for the requested navigation.
       */
      url: string;
      /**
       * The disposition for the navigation.
       */
      disposition: ClientNavigationDisposition;
    };
    /**
     * Fired when frame schedules a potential navigation.
     * @event `Page.frameScheduledNavigation`
     */
    export type FrameScheduledNavigationEvent = {
      /**
       * Id of the frame that has scheduled a navigation.
       */
      frameId: FrameId;
      /**
       * Delay (in seconds) until the navigation is scheduled to begin. The navigation is not
       * guaranteed to start.
       */
      delay: number;
      /**
       * The reason for the navigation.
       */
      reason: ClientNavigationReason;
      /**
       * The destination URL for the scheduled navigation.
       */
      url: string;
    };
    /**
     * Fired when frame has started loading.
     * @event `Page.frameStartedLoading`
     */
    export type FrameStartedLoadingEvent = {
      /**
       * Id of the frame that has started loading.
       */
      frameId: FrameId;
    };
    /**
     * Fired when frame has stopped loading.
     * @event `Page.frameStoppedLoading`
     */
    export type FrameStoppedLoadingEvent = {
      /**
       * Id of the frame that has stopped loading.
       */
      frameId: FrameId;
    };
    /**
     * Fired when page is about to start a download.
     * Deprecated. Use Browser.downloadWillBegin instead.
     * @event `Page.downloadWillBegin`
     */
    export type DownloadWillBeginEvent = {
      /**
       * Id of the frame that caused download to begin.
       */
      frameId: FrameId;
      /**
       * Global unique identifier of the download.
       */
      guid: string;
      /**
       * URL of the resource being downloaded.
       */
      url: string;
      /**
       * Suggested file name of the resource (the actual name of the file saved on disk may differ).
       */
      suggestedFilename: string;
    };
    /**
     * Fired when download makes progress. Last call has |done| == true.
     * Deprecated. Use Browser.downloadProgress instead.
     * @event `Page.downloadProgress`
     */
    export type DownloadProgressEvent = {
      /**
       * Global unique identifier of the download.
       */
      guid: string;
      /**
       * Total expected bytes to download.
       */
      totalBytes: number;
      /**
       * Total bytes received.
       */
      receivedBytes: number;
      /**
       * Download status.
       */
      state: "inProgress" | "completed" | "canceled";
    };
    /**
     * Fired when interstitial page was hidden
     * @event `Page.interstitialHidden`
     */
    export type InterstitialHiddenEvent = {};
    /**
     * Fired when interstitial page was shown
     * @event `Page.interstitialShown`
     */
    export type InterstitialShownEvent = {};
    /**
     * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) has been
     * closed.
     * @event `Page.javascriptDialogClosed`
     */
    export type JavascriptDialogClosedEvent = {
      /**
       * Whether dialog was confirmed.
       */
      result: boolean;
      /**
       * User input in case of prompt.
       */
      userInput: string;
    };
    /**
     * Fired when a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload) is about to
     * open.
     * @event `Page.javascriptDialogOpening`
     */
    export type JavascriptDialogOpeningEvent = {
      /**
       * Frame url.
       */
      url: string;
      /**
       * Message that will be displayed by the dialog.
       */
      message: string;
      /**
       * Dialog type.
       */
      type: DialogType;
      /**
       * True iff browser is capable showing or acting on the given dialog. When browser has no
       * dialog handler for given target, calling alert while Page domain is engaged will stall
       * the page execution. Execution can be resumed via calling Page.handleJavaScriptDialog.
       */
      hasBrowserHandler: boolean;
      /**
       * Default dialog prompt.
       */
      defaultPrompt?: string | undefined;
    };
    /**
     * Fired for top level page lifecycle events such as navigation, load, paint, etc.
     * @event `Page.lifecycleEvent`
     */
    export type LifecycleEventEvent = {
      /**
       * Id of the frame.
       */
      frameId: FrameId;
      /**
       * Loader identifier. Empty string if the request is fetched from worker.
       */
      loaderId: Network.LoaderId;
      name: string;
      timestamp: Network.MonotonicTime;
    };
    /**
     * Fired for failed bfcache history navigations if BackForwardCache feature is enabled. Do
     * not assume any ordering with the Page.frameNavigated event. This event is fired only for
     * main-frame history navigation where the document changes (non-same-document navigations),
     * when bfcache navigation fails.
     * @event `Page.backForwardCacheNotUsed`
     */
    export type BackForwardCacheNotUsedEvent = {
      /**
       * The loader id for the associated navgation.
       */
      loaderId: Network.LoaderId;
      /**
       * The frame id of the associated frame.
       */
      frameId: FrameId;
      /**
       * Array of reasons why the page could not be cached. This must not be empty.
       */
      notRestoredExplanations: BackForwardCacheNotRestoredExplanation[];
      /**
       * Tree structure of reasons why the page could not be cached for each frame.
       */
      notRestoredExplanationsTree?: BackForwardCacheNotRestoredExplanationTree | undefined;
    };
    /**
     * undefined
     * @event `Page.loadEventFired`
     */
    export type LoadEventFiredEvent = {
      timestamp: Network.MonotonicTime;
    };
    /**
     * Fired when same-document navigation happens, e.g. due to history API usage or anchor navigation.
     * @event `Page.navigatedWithinDocument`
     */
    export type NavigatedWithinDocumentEvent = {
      /**
       * Id of the frame.
       */
      frameId: FrameId;
      /**
       * Frame's new url.
       */
      url: string;
    };
    /**
     * Compressed image data requested by the `startScreencast`.
     * @event `Page.screencastFrame`
     */
    export type ScreencastFrameEvent = {
      /**
       * Base64-encoded compressed image. (Encoded as a base64 string when passed over JSON)
       */
      data: string;
      /**
       * Screencast frame metadata.
       */
      metadata: ScreencastFrameMetadata;
      /**
       * Frame number.
       */
      sessionId: number;
    };
    /**
     * Fired when the page with currently enabled screencast was shown or hidden `.
     * @event `Page.screencastVisibilityChanged`
     */
    export type ScreencastVisibilityChangedEvent = {
      /**
       * True if the page is visible.
       */
      visible: boolean;
    };
    /**
     * Fired when a new window is going to be opened, via window.open(), link click, form submission,
     * etc.
     * @event `Page.windowOpen`
     */
    export type WindowOpenEvent = {
      /**
       * The URL for the new window.
       */
      url: string;
      /**
       * Window name.
       */
      windowName: string;
      /**
       * An array of enabled window features.
       */
      windowFeatures: string[];
      /**
       * Whether or not it was triggered by user gesture.
       */
      userGesture: boolean;
    };
    /**
     * Issued for every compilation cache generated. Is only available
     * if Page.setGenerateCompilationCache is enabled.
     * @event `Page.compilationCacheProduced`
     */
    export type CompilationCacheProducedEvent = {
      url: string;
      /**
       * Base64-encoded data (Encoded as a base64 string when passed over JSON)
       */
      data: string;
    };
    /**
     * Deprecated, please use addScriptToEvaluateOnNewDocument instead.
     * @request `Page.addScriptToEvaluateOnLoad`
     */
    export type AddScriptToEvaluateOnLoadRequest = {
      scriptSource: string;
    };
    /**
     * Deprecated, please use addScriptToEvaluateOnNewDocument instead.
     * @response `Page.addScriptToEvaluateOnLoad`
     */
    export type AddScriptToEvaluateOnLoadResponse = {
      /**
       * Identifier of the added script.
       */
      identifier: ScriptIdentifier;
    };
    /**
     * Evaluates given script in every frame upon creation (before loading frame's scripts).
     * @request `Page.addScriptToEvaluateOnNewDocument`
     */
    export type AddScriptToEvaluateOnNewDocumentRequest = {
      source: string;
      /**
       * If specified, creates an isolated world with the given name and evaluates given script in it.
       * This world name will be used as the ExecutionContextDescription::name when the corresponding
       * event is emitted.
       */
      worldName?: string | undefined;
      /**
       * Specifies whether command line API should be available to the script, defaults
       * to false.
       */
      includeCommandLineAPI?: boolean | undefined;
      /**
       * If true, runs the script immediately on existing execution contexts or worlds.
       * Default: false.
       */
      runImmediately?: boolean | undefined;
    };
    /**
     * Evaluates given script in every frame upon creation (before loading frame's scripts).
     * @response `Page.addScriptToEvaluateOnNewDocument`
     */
    export type AddScriptToEvaluateOnNewDocumentResponse = {
      /**
       * Identifier of the added script.
       */
      identifier: ScriptIdentifier;
    };
    /**
     * Brings page to front (activates tab).
     * @request `Page.bringToFront`
     */
    export type BringToFrontRequest = {};
    /**
     * Brings page to front (activates tab).
     * @response `Page.bringToFront`
     */
    export type BringToFrontResponse = {};
    /**
     * Capture page screenshot.
     * @request `Page.captureScreenshot`
     */
    export type CaptureScreenshotRequest = {
      /**
       * Image compression format (defaults to png).
       */
      format?: "jpeg" | "png" | "webp" | undefined;
      /**
       * Compression quality from range [0..100] (jpeg only).
       */
      quality?: number | undefined;
      /**
       * Capture the screenshot of a given region only.
       */
      clip?: Viewport | undefined;
      /**
       * Capture the screenshot from the surface, rather than the view. Defaults to true.
       */
      fromSurface?: boolean | undefined;
      /**
       * Capture the screenshot beyond the viewport. Defaults to false.
       */
      captureBeyondViewport?: boolean | undefined;
      /**
       * Optimize image encoding for speed, not for resulting size (defaults to false)
       */
      optimizeForSpeed?: boolean | undefined;
    };
    /**
     * Capture page screenshot.
     * @response `Page.captureScreenshot`
     */
    export type CaptureScreenshotResponse = {
      /**
       * Base64-encoded image data. (Encoded as a base64 string when passed over JSON)
       */
      data: string;
    };
    /**
     * Returns a snapshot of the page as a string. For MHTML format, the serialization includes
     * iframes, shadow DOM, external resources, and element-inline styles.
     * @request `Page.captureSnapshot`
     */
    export type CaptureSnapshotRequest = {
      /**
       * Format (defaults to mhtml).
       */
      format?: "mhtml" | undefined;
    };
    /**
     * Returns a snapshot of the page as a string. For MHTML format, the serialization includes
     * iframes, shadow DOM, external resources, and element-inline styles.
     * @response `Page.captureSnapshot`
     */
    export type CaptureSnapshotResponse = {
      /**
       * Serialized page data.
       */
      data: string;
    };
    /**
     * Clears the overridden device metrics.
     * @request `Page.clearDeviceMetricsOverride`
     */
    export type ClearDeviceMetricsOverrideRequest = {};
    /**
     * Clears the overridden device metrics.
     * @response `Page.clearDeviceMetricsOverride`
     */
    export type ClearDeviceMetricsOverrideResponse = {};
    /**
     * Clears the overridden Device Orientation.
     * @request `Page.clearDeviceOrientationOverride`
     */
    export type ClearDeviceOrientationOverrideRequest = {};
    /**
     * Clears the overridden Device Orientation.
     * @response `Page.clearDeviceOrientationOverride`
     */
    export type ClearDeviceOrientationOverrideResponse = {};
    /**
     * Clears the overridden Geolocation Position and Error.
     * @request `Page.clearGeolocationOverride`
     */
    export type ClearGeolocationOverrideRequest = {};
    /**
     * Clears the overridden Geolocation Position and Error.
     * @response `Page.clearGeolocationOverride`
     */
    export type ClearGeolocationOverrideResponse = {};
    /**
     * Creates an isolated world for the given frame.
     * @request `Page.createIsolatedWorld`
     */
    export type CreateIsolatedWorldRequest = {
      /**
       * Id of the frame in which the isolated world should be created.
       */
      frameId: FrameId;
      /**
       * An optional name which is reported in the Execution Context.
       */
      worldName?: string | undefined;
      /**
       * Whether or not universal access should be granted to the isolated world. This is a powerful
       * option, use with caution.
       */
      grantUniveralAccess?: boolean | undefined;
    };
    /**
     * Creates an isolated world for the given frame.
     * @response `Page.createIsolatedWorld`
     */
    export type CreateIsolatedWorldResponse = {
      /**
       * Execution context of the isolated world.
       */
      executionContextId: Runtime.ExecutionContextId;
    };
    /**
     * Deletes browser cookie with given name, domain and path.
     * @request `Page.deleteCookie`
     */
    export type DeleteCookieRequest = {
      /**
       * Name of the cookie to remove.
       */
      cookieName: string;
      /**
       * URL to match cooke domain and path.
       */
      url: string;
    };
    /**
     * Deletes browser cookie with given name, domain and path.
     * @response `Page.deleteCookie`
     */
    export type DeleteCookieResponse = {};
    /**
     * Disables page domain notifications.
     * @request `Page.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables page domain notifications.
     * @response `Page.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables page domain notifications.
     * @request `Page.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables page domain notifications.
     * @response `Page.enable`
     */
    export type EnableResponse = {};
    /**
     * undefined
     * @request `Page.getAppManifest`
     */
    export type GetAppManifestRequest = {};
    /**
     * undefined
     * @response `Page.getAppManifest`
     */
    export type GetAppManifestResponse = {
      /**
       * Manifest location.
       */
      url: string;
      errors: AppManifestError[];
      /**
       * Manifest content.
       */
      data?: string | undefined;
      /**
       * Parsed manifest properties
       */
      parsed?: AppManifestParsedProperties | undefined;
    };
    /**
     * undefined
     * @request `Page.getInstallabilityErrors`
     */
    export type GetInstallabilityErrorsRequest = {};
    /**
     * undefined
     * @response `Page.getInstallabilityErrors`
     */
    export type GetInstallabilityErrorsResponse = {
      installabilityErrors: InstallabilityError[];
    };
    /**
     * Deprecated because it's not guaranteed that the returned icon is in fact the one used for PWA installation.
     * @request `Page.getManifestIcons`
     */
    export type GetManifestIconsRequest = {};
    /**
     * Deprecated because it's not guaranteed that the returned icon is in fact the one used for PWA installation.
     * @response `Page.getManifestIcons`
     */
    export type GetManifestIconsResponse = {
      primaryIcon?: string | undefined;
    };
    /**
     * Returns the unique (PWA) app id.
     * Only returns values if the feature flag 'WebAppEnableManifestId' is enabled
     * @request `Page.getAppId`
     */
    export type GetAppIdRequest = {};
    /**
     * Returns the unique (PWA) app id.
     * Only returns values if the feature flag 'WebAppEnableManifestId' is enabled
     * @response `Page.getAppId`
     */
    export type GetAppIdResponse = {
      /**
       * App id, either from manifest's id attribute or computed from start_url
       */
      appId?: string | undefined;
      /**
       * Recommendation for manifest's id attribute to match current id computed from start_url
       */
      recommendedId?: string | undefined;
    };
    /**
     * undefined
     * @request `Page.getAdScriptId`
     */
    export type GetAdScriptIdRequest = {
      frameId: FrameId;
    };
    /**
     * undefined
     * @response `Page.getAdScriptId`
     */
    export type GetAdScriptIdResponse = {
      /**
       * Identifies the bottom-most script which caused the frame to be labelled
       * as an ad. Only sent if frame is labelled as an ad and id is available.
       */
      adScriptId?: AdScriptId | undefined;
    };
    /**
     * Returns present frame tree structure.
     * @request `Page.getFrameTree`
     */
    export type GetFrameTreeRequest = {};
    /**
     * Returns present frame tree structure.
     * @response `Page.getFrameTree`
     */
    export type GetFrameTreeResponse = {
      /**
       * Present frame tree structure.
       */
      frameTree: FrameTree;
    };
    /**
     * Returns metrics relating to the layouting of the page, such as viewport bounds/scale.
     * @request `Page.getLayoutMetrics`
     */
    export type GetLayoutMetricsRequest = {};
    /**
     * Returns metrics relating to the layouting of the page, such as viewport bounds/scale.
     * @response `Page.getLayoutMetrics`
     */
    export type GetLayoutMetricsResponse = {
      /**
       * Deprecated metrics relating to the layout viewport. Is in device pixels. Use `cssLayoutViewport` instead.
       */
      layoutViewport: LayoutViewport;
      /**
       * Deprecated metrics relating to the visual viewport. Is in device pixels. Use `cssVisualViewport` instead.
       */
      visualViewport: VisualViewport;
      /**
       * Deprecated size of scrollable area. Is in DP. Use `cssContentSize` instead.
       */
      contentSize: DOM.Rect;
      /**
       * Metrics relating to the layout viewport in CSS pixels.
       */
      cssLayoutViewport: LayoutViewport;
      /**
       * Metrics relating to the visual viewport in CSS pixels.
       */
      cssVisualViewport: VisualViewport;
      /**
       * Size of scrollable area in CSS pixels.
       */
      cssContentSize: DOM.Rect;
    };
    /**
     * Returns navigation history for the current page.
     * @request `Page.getNavigationHistory`
     */
    export type GetNavigationHistoryRequest = {};
    /**
     * Returns navigation history for the current page.
     * @response `Page.getNavigationHistory`
     */
    export type GetNavigationHistoryResponse = {
      /**
       * Index of the current navigation history entry.
       */
      currentIndex: number;
      /**
       * Array of navigation history entries.
       */
      entries: NavigationEntry[];
    };
    /**
     * Resets navigation history for the current page.
     * @request `Page.resetNavigationHistory`
     */
    export type ResetNavigationHistoryRequest = {};
    /**
     * Resets navigation history for the current page.
     * @response `Page.resetNavigationHistory`
     */
    export type ResetNavigationHistoryResponse = {};
    /**
     * Returns content of the given resource.
     * @request `Page.getResourceContent`
     */
    export type GetResourceContentRequest = {
      /**
       * Frame id to get resource for.
       */
      frameId: FrameId;
      /**
       * URL of the resource to get content for.
       */
      url: string;
    };
    /**
     * Returns content of the given resource.
     * @response `Page.getResourceContent`
     */
    export type GetResourceContentResponse = {
      /**
       * Resource content.
       */
      content: string;
      /**
       * True, if content was served as base64.
       */
      base64Encoded: boolean;
    };
    /**
     * Returns present frame / resource tree structure.
     * @request `Page.getResourceTree`
     */
    export type GetResourceTreeRequest = {};
    /**
     * Returns present frame / resource tree structure.
     * @response `Page.getResourceTree`
     */
    export type GetResourceTreeResponse = {
      /**
       * Present frame / resource tree structure.
       */
      frameTree: FrameResourceTree;
    };
    /**
     * Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload).
     * @request `Page.handleJavaScriptDialog`
     */
    export type HandleJavaScriptDialogRequest = {
      /**
       * Whether to accept or dismiss the dialog.
       */
      accept: boolean;
      /**
       * The text to enter into the dialog prompt before accepting. Used only if this is a prompt
       * dialog.
       */
      promptText?: string | undefined;
    };
    /**
     * Accepts or dismisses a JavaScript initiated dialog (alert, confirm, prompt, or onbeforeunload).
     * @response `Page.handleJavaScriptDialog`
     */
    export type HandleJavaScriptDialogResponse = {};
    /**
     * Navigates current page to the given URL.
     * @request `Page.navigate`
     */
    export type NavigateRequest = {
      /**
       * URL to navigate the page to.
       */
      url: string;
      /**
       * Referrer URL.
       */
      referrer?: string | undefined;
      /**
       * Intended transition type.
       */
      transitionType?: TransitionType | undefined;
      /**
       * Frame id to navigate, if not specified navigates the top frame.
       */
      frameId?: FrameId | undefined;
      /**
       * Referrer-policy used for the navigation.
       */
      referrerPolicy?: ReferrerPolicy | undefined;
    };
    /**
     * Navigates current page to the given URL.
     * @response `Page.navigate`
     */
    export type NavigateResponse = {
      /**
       * Frame id that has navigated (or failed to navigate)
       */
      frameId: FrameId;
      /**
       * Loader identifier. This is omitted in case of same-document navigation,
       * as the previously committed loaderId would not change.
       */
      loaderId?: Network.LoaderId | undefined;
      /**
       * User friendly error message, present if and only if navigation has failed.
       */
      errorText?: string | undefined;
    };
    /**
     * Navigates current page to the given history entry.
     * @request `Page.navigateToHistoryEntry`
     */
    export type NavigateToHistoryEntryRequest = {
      /**
       * Unique id of the entry to navigate to.
       */
      entryId: number;
    };
    /**
     * Navigates current page to the given history entry.
     * @response `Page.navigateToHistoryEntry`
     */
    export type NavigateToHistoryEntryResponse = {};
    /**
     * Print page as PDF.
     * @request `Page.printToPDF`
     */
    export type PrintToPDFRequest = {
      /**
       * Paper orientation. Defaults to false.
       */
      landscape?: boolean | undefined;
      /**
       * Display header and footer. Defaults to false.
       */
      displayHeaderFooter?: boolean | undefined;
      /**
       * Print background graphics. Defaults to false.
       */
      printBackground?: boolean | undefined;
      /**
       * Scale of the webpage rendering. Defaults to 1.
       */
      scale?: number | undefined;
      /**
       * Paper width in inches. Defaults to 8.5 inches.
       */
      paperWidth?: number | undefined;
      /**
       * Paper height in inches. Defaults to 11 inches.
       */
      paperHeight?: number | undefined;
      /**
       * Top margin in inches. Defaults to 1cm (~0.4 inches).
       */
      marginTop?: number | undefined;
      /**
       * Bottom margin in inches. Defaults to 1cm (~0.4 inches).
       */
      marginBottom?: number | undefined;
      /**
       * Left margin in inches. Defaults to 1cm (~0.4 inches).
       */
      marginLeft?: number | undefined;
      /**
       * Right margin in inches. Defaults to 1cm (~0.4 inches).
       */
      marginRight?: number | undefined;
      /**
       * Paper ranges to print, one based, e.g., '1-5, 8, 11-13'. Pages are
       * printed in the document order, not in the order specified, and no
       * more than once.
       * Defaults to empty string, which implies the entire document is printed.
       * The page numbers are quietly capped to actual page count of the
       * document, and ranges beyond the end of the document are ignored.
       * If this results in no pages to print, an error is reported.
       * It is an error to specify a range with start greater than end.
       */
      pageRanges?: string | undefined;
      /**
       * HTML template for the print header. Should be valid HTML markup with following
       * classes used to inject printing values into them:
       * - `date`: formatted print date
       * - `title`: document title
       * - `url`: document location
       * - `pageNumber`: current page number
       * - `totalPages`: total pages in the document
       *
       * For example, `<span class=title></span>` would generate span containing the title.
       */
      headerTemplate?: string | undefined;
      /**
       * HTML template for the print footer. Should use the same format as the `headerTemplate`.
       */
      footerTemplate?: string | undefined;
      /**
       * Whether or not to prefer page size as defined by css. Defaults to false,
       * in which case the content will be scaled to fit the paper size.
       */
      preferCSSPageSize?: boolean | undefined;
      /**
       * return as stream
       */
      transferMode?: "ReturnAsBase64" | "ReturnAsStream" | undefined;
      /**
       * Whether or not to generate tagged (accessible) PDF. Defaults to embedder choice.
       */
      generateTaggedPDF?: boolean | undefined;
      /**
       * Whether or not to embed the document outline into the PDF.
       */
      generateDocumentOutline?: boolean | undefined;
    };
    /**
     * Print page as PDF.
     * @response `Page.printToPDF`
     */
    export type PrintToPDFResponse = {
      /**
       * Base64-encoded pdf data. Empty if |returnAsStream| is specified. (Encoded as a base64 string when passed over JSON)
       */
      data: string;
      /**
       * A handle of the stream that holds resulting PDF data.
       */
      stream?: IO.StreamHandle | undefined;
    };
    /**
     * Reloads given page optionally ignoring the cache.
     * @request `Page.reload`
     */
    export type ReloadRequest = {
      /**
       * If true, browser cache is ignored (as if the user pressed Shift+refresh).
       */
      ignoreCache?: boolean | undefined;
      /**
       * If set, the script will be injected into all frames of the inspected page after reload.
       * Argument will be ignored if reloading dataURL origin.
       */
      scriptToEvaluateOnLoad?: string | undefined;
    };
    /**
     * Reloads given page optionally ignoring the cache.
     * @response `Page.reload`
     */
    export type ReloadResponse = {};
    /**
     * Deprecated, please use removeScriptToEvaluateOnNewDocument instead.
     * @request `Page.removeScriptToEvaluateOnLoad`
     */
    export type RemoveScriptToEvaluateOnLoadRequest = {
      identifier: ScriptIdentifier;
    };
    /**
     * Deprecated, please use removeScriptToEvaluateOnNewDocument instead.
     * @response `Page.removeScriptToEvaluateOnLoad`
     */
    export type RemoveScriptToEvaluateOnLoadResponse = {};
    /**
     * Removes given script from the list.
     * @request `Page.removeScriptToEvaluateOnNewDocument`
     */
    export type RemoveScriptToEvaluateOnNewDocumentRequest = {
      identifier: ScriptIdentifier;
    };
    /**
     * Removes given script from the list.
     * @response `Page.removeScriptToEvaluateOnNewDocument`
     */
    export type RemoveScriptToEvaluateOnNewDocumentResponse = {};
    /**
     * Acknowledges that a screencast frame has been received by the frontend.
     * @request `Page.screencastFrameAck`
     */
    export type ScreencastFrameAckRequest = {
      /**
       * Frame number.
       */
      sessionId: number;
    };
    /**
     * Acknowledges that a screencast frame has been received by the frontend.
     * @response `Page.screencastFrameAck`
     */
    export type ScreencastFrameAckResponse = {};
    /**
     * Searches for given string in resource content.
     * @request `Page.searchInResource`
     */
    export type SearchInResourceRequest = {
      /**
       * Frame id for resource to search in.
       */
      frameId: FrameId;
      /**
       * URL of the resource to search in.
       */
      url: string;
      /**
       * String to search for.
       */
      query: string;
      /**
       * If true, search is case sensitive.
       */
      caseSensitive?: boolean | undefined;
      /**
       * If true, treats string parameter as regex.
       */
      isRegex?: boolean | undefined;
    };
    /**
     * Searches for given string in resource content.
     * @response `Page.searchInResource`
     */
    export type SearchInResourceResponse = {
      /**
       * List of search matches.
       */
      result: Debugger.SearchMatch[];
    };
    /**
     * Enable Chrome's experimental ad filter on all sites.
     * @request `Page.setAdBlockingEnabled`
     */
    export type SetAdBlockingEnabledRequest = {
      /**
       * Whether to block ads.
       */
      enabled: boolean;
    };
    /**
     * Enable Chrome's experimental ad filter on all sites.
     * @response `Page.setAdBlockingEnabled`
     */
    export type SetAdBlockingEnabledResponse = {};
    /**
     * Enable page Content Security Policy by-passing.
     * @request `Page.setBypassCSP`
     */
    export type SetBypassCSPRequest = {
      /**
       * Whether to bypass page CSP.
       */
      enabled: boolean;
    };
    /**
     * Enable page Content Security Policy by-passing.
     * @response `Page.setBypassCSP`
     */
    export type SetBypassCSPResponse = {};
    /**
     * Get Permissions Policy state on given frame.
     * @request `Page.getPermissionsPolicyState`
     */
    export type GetPermissionsPolicyStateRequest = {
      frameId: FrameId;
    };
    /**
     * Get Permissions Policy state on given frame.
     * @response `Page.getPermissionsPolicyState`
     */
    export type GetPermissionsPolicyStateResponse = {
      states: PermissionsPolicyFeatureState[];
    };
    /**
     * Get Origin Trials on given frame.
     * @request `Page.getOriginTrials`
     */
    export type GetOriginTrialsRequest = {
      frameId: FrameId;
    };
    /**
     * Get Origin Trials on given frame.
     * @response `Page.getOriginTrials`
     */
    export type GetOriginTrialsResponse = {
      originTrials: OriginTrial[];
    };
    /**
     * Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
     * window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
     * query results).
     * @request `Page.setDeviceMetricsOverride`
     */
    export type SetDeviceMetricsOverrideRequest = {
      /**
       * Overriding width value in pixels (minimum 0, maximum 10000000). 0 disables the override.
       */
      width: number;
      /**
       * Overriding height value in pixels (minimum 0, maximum 10000000). 0 disables the override.
       */
      height: number;
      /**
       * Overriding device scale factor value. 0 disables the override.
       */
      deviceScaleFactor: number;
      /**
       * Whether to emulate mobile device. This includes viewport meta tag, overlay scrollbars, text
       * autosizing and more.
       */
      mobile: boolean;
      /**
       * Scale to apply to resulting view image.
       */
      scale?: number | undefined;
      /**
       * Overriding screen width value in pixels (minimum 0, maximum 10000000).
       */
      screenWidth?: number | undefined;
      /**
       * Overriding screen height value in pixels (minimum 0, maximum 10000000).
       */
      screenHeight?: number | undefined;
      /**
       * Overriding view X position on screen in pixels (minimum 0, maximum 10000000).
       */
      positionX?: number | undefined;
      /**
       * Overriding view Y position on screen in pixels (minimum 0, maximum 10000000).
       */
      positionY?: number | undefined;
      /**
       * Do not set visible view size, rely upon explicit setVisibleSize call.
       */
      dontSetVisibleSize?: boolean | undefined;
      /**
       * Screen orientation override.
       */
      screenOrientation?: Emulation.ScreenOrientation | undefined;
      /**
       * The viewport dimensions and scale. If not set, the override is cleared.
       */
      viewport?: Viewport | undefined;
    };
    /**
     * Overrides the values of device screen dimensions (window.screen.width, window.screen.height,
     * window.innerWidth, window.innerHeight, and "device-width"/"device-height"-related CSS media
     * query results).
     * @response `Page.setDeviceMetricsOverride`
     */
    export type SetDeviceMetricsOverrideResponse = {};
    /**
     * Overrides the Device Orientation.
     * @request `Page.setDeviceOrientationOverride`
     */
    export type SetDeviceOrientationOverrideRequest = {
      /**
       * Mock alpha
       */
      alpha: number;
      /**
       * Mock beta
       */
      beta: number;
      /**
       * Mock gamma
       */
      gamma: number;
    };
    /**
     * Overrides the Device Orientation.
     * @response `Page.setDeviceOrientationOverride`
     */
    export type SetDeviceOrientationOverrideResponse = {};
    /**
     * Set generic font families.
     * @request `Page.setFontFamilies`
     */
    export type SetFontFamiliesRequest = {
      /**
       * Specifies font families to set. If a font family is not specified, it won't be changed.
       */
      fontFamilies: FontFamilies;
      /**
       * Specifies font families to set for individual scripts.
       */
      forScripts?: ScriptFontFamilies[] | undefined;
    };
    /**
     * Set generic font families.
     * @response `Page.setFontFamilies`
     */
    export type SetFontFamiliesResponse = {};
    /**
     * Set default font sizes.
     * @request `Page.setFontSizes`
     */
    export type SetFontSizesRequest = {
      /**
       * Specifies font sizes to set. If a font size is not specified, it won't be changed.
       */
      fontSizes: FontSizes;
    };
    /**
     * Set default font sizes.
     * @response `Page.setFontSizes`
     */
    export type SetFontSizesResponse = {};
    /**
     * Sets given markup as the document's HTML.
     * @request `Page.setDocumentContent`
     */
    export type SetDocumentContentRequest = {
      /**
       * Frame id to set HTML for.
       */
      frameId: FrameId;
      /**
       * HTML content to set.
       */
      html: string;
    };
    /**
     * Sets given markup as the document's HTML.
     * @response `Page.setDocumentContent`
     */
    export type SetDocumentContentResponse = {};
    /**
     * Set the behavior when downloading a file.
     * @request `Page.setDownloadBehavior`
     */
    export type SetDownloadBehaviorRequest = {
      /**
       * Whether to allow all or deny all download requests, or use default Chrome behavior if
       * available (otherwise deny).
       */
      behavior: "deny" | "allow" | "default";
      /**
       * The default path to save downloaded files to. This is required if behavior is set to 'allow'
       */
      downloadPath?: string | undefined;
    };
    /**
     * Set the behavior when downloading a file.
     * @response `Page.setDownloadBehavior`
     */
    export type SetDownloadBehaviorResponse = {};
    /**
     * Overrides the Geolocation Position or Error. Omitting any of the parameters emulates position
     * unavailable.
     * @request `Page.setGeolocationOverride`
     */
    export type SetGeolocationOverrideRequest = {
      /**
       * Mock latitude
       */
      latitude?: number | undefined;
      /**
       * Mock longitude
       */
      longitude?: number | undefined;
      /**
       * Mock accuracy
       */
      accuracy?: number | undefined;
    };
    /**
     * Overrides the Geolocation Position or Error. Omitting any of the parameters emulates position
     * unavailable.
     * @response `Page.setGeolocationOverride`
     */
    export type SetGeolocationOverrideResponse = {};
    /**
     * Controls whether page will emit lifecycle events.
     * @request `Page.setLifecycleEventsEnabled`
     */
    export type SetLifecycleEventsEnabledRequest = {
      /**
       * If true, starts emitting lifecycle events.
       */
      enabled: boolean;
    };
    /**
     * Controls whether page will emit lifecycle events.
     * @response `Page.setLifecycleEventsEnabled`
     */
    export type SetLifecycleEventsEnabledResponse = {};
    /**
     * Toggles mouse event-based touch event emulation.
     * @request `Page.setTouchEmulationEnabled`
     */
    export type SetTouchEmulationEnabledRequest = {
      /**
       * Whether the touch event emulation should be enabled.
       */
      enabled: boolean;
      /**
       * Touch/gesture events configuration. Default: current platform.
       */
      configuration?: "mobile" | "desktop" | undefined;
    };
    /**
     * Toggles mouse event-based touch event emulation.
     * @response `Page.setTouchEmulationEnabled`
     */
    export type SetTouchEmulationEnabledResponse = {};
    /**
     * Starts sending each frame using the `screencastFrame` event.
     * @request `Page.startScreencast`
     */
    export type StartScreencastRequest = {
      /**
       * Image compression format.
       */
      format?: "jpeg" | "png" | undefined;
      /**
       * Compression quality from range [0..100].
       */
      quality?: number | undefined;
      /**
       * Maximum screenshot width.
       */
      maxWidth?: number | undefined;
      /**
       * Maximum screenshot height.
       */
      maxHeight?: number | undefined;
      /**
       * Send every n-th frame.
       */
      everyNthFrame?: number | undefined;
    };
    /**
     * Starts sending each frame using the `screencastFrame` event.
     * @response `Page.startScreencast`
     */
    export type StartScreencastResponse = {};
    /**
     * Force the page stop all navigations and pending resource fetches.
     * @request `Page.stopLoading`
     */
    export type StopLoadingRequest = {};
    /**
     * Force the page stop all navigations and pending resource fetches.
     * @response `Page.stopLoading`
     */
    export type StopLoadingResponse = {};
    /**
     * Crashes renderer on the IO thread, generates minidumps.
     * @request `Page.crash`
     */
    export type CrashRequest = {};
    /**
     * Crashes renderer on the IO thread, generates minidumps.
     * @response `Page.crash`
     */
    export type CrashResponse = {};
    /**
     * Tries to close page, running its beforeunload hooks, if any.
     * @request `Page.close`
     */
    export type CloseRequest = {};
    /**
     * Tries to close page, running its beforeunload hooks, if any.
     * @response `Page.close`
     */
    export type CloseResponse = {};
    /**
     * Tries to update the web lifecycle state of the page.
     * It will transition the page to the given state according to:
     * https://github.com/WICG/web-lifecycle/
     * @request `Page.setWebLifecycleState`
     */
    export type SetWebLifecycleStateRequest = {
      /**
       * Target lifecycle state
       */
      state: "frozen" | "active";
    };
    /**
     * Tries to update the web lifecycle state of the page.
     * It will transition the page to the given state according to:
     * https://github.com/WICG/web-lifecycle/
     * @response `Page.setWebLifecycleState`
     */
    export type SetWebLifecycleStateResponse = {};
    /**
     * Stops sending each frame in the `screencastFrame`.
     * @request `Page.stopScreencast`
     */
    export type StopScreencastRequest = {};
    /**
     * Stops sending each frame in the `screencastFrame`.
     * @response `Page.stopScreencast`
     */
    export type StopScreencastResponse = {};
    /**
     * Requests backend to produce compilation cache for the specified scripts.
     * `scripts` are appeneded to the list of scripts for which the cache
     * would be produced. The list may be reset during page navigation.
     * When script with a matching URL is encountered, the cache is optionally
     * produced upon backend discretion, based on internal heuristics.
     * See also: `Page.compilationCacheProduced`.
     * @request `Page.produceCompilationCache`
     */
    export type ProduceCompilationCacheRequest = {
      scripts: CompilationCacheParams[];
    };
    /**
     * Requests backend to produce compilation cache for the specified scripts.
     * `scripts` are appeneded to the list of scripts for which the cache
     * would be produced. The list may be reset during page navigation.
     * When script with a matching URL is encountered, the cache is optionally
     * produced upon backend discretion, based on internal heuristics.
     * See also: `Page.compilationCacheProduced`.
     * @response `Page.produceCompilationCache`
     */
    export type ProduceCompilationCacheResponse = {};
    /**
     * Seeds compilation cache for given url. Compilation cache does not survive
     * cross-process navigation.
     * @request `Page.addCompilationCache`
     */
    export type AddCompilationCacheRequest = {
      url: string;
      /**
       * Base64-encoded data (Encoded as a base64 string when passed over JSON)
       */
      data: string;
    };
    /**
     * Seeds compilation cache for given url. Compilation cache does not survive
     * cross-process navigation.
     * @response `Page.addCompilationCache`
     */
    export type AddCompilationCacheResponse = {};
    /**
     * Clears seeded compilation cache.
     * @request `Page.clearCompilationCache`
     */
    export type ClearCompilationCacheRequest = {};
    /**
     * Clears seeded compilation cache.
     * @response `Page.clearCompilationCache`
     */
    export type ClearCompilationCacheResponse = {};
    /**
     * Sets the Secure Payment Confirmation transaction mode.
     * https://w3c.github.io/secure-payment-confirmation/#sctn-automation-set-spc-transaction-mode
     * @request `Page.setSPCTransactionMode`
     */
    export type SetSPCTransactionModeRequest = {
      mode: AutoResponseMode;
    };
    /**
     * Sets the Secure Payment Confirmation transaction mode.
     * https://w3c.github.io/secure-payment-confirmation/#sctn-automation-set-spc-transaction-mode
     * @response `Page.setSPCTransactionMode`
     */
    export type SetSPCTransactionModeResponse = {};
    /**
     * Extensions for Custom Handlers API:
     * https://html.spec.whatwg.org/multipage/system-state.html#rph-automation
     * @request `Page.setRPHRegistrationMode`
     */
    export type SetRPHRegistrationModeRequest = {
      mode: AutoResponseMode;
    };
    /**
     * Extensions for Custom Handlers API:
     * https://html.spec.whatwg.org/multipage/system-state.html#rph-automation
     * @response `Page.setRPHRegistrationMode`
     */
    export type SetRPHRegistrationModeResponse = {};
    /**
     * Generates a report for testing.
     * @request `Page.generateTestReport`
     */
    export type GenerateTestReportRequest = {
      /**
       * Message to be displayed in the report.
       */
      message: string;
      /**
       * Specifies the endpoint group to deliver the report to.
       */
      group?: string | undefined;
    };
    /**
     * Generates a report for testing.
     * @response `Page.generateTestReport`
     */
    export type GenerateTestReportResponse = {};
    /**
     * Pauses page execution. Can be resumed using generic Runtime.runIfWaitingForDebugger.
     * @request `Page.waitForDebugger`
     */
    export type WaitForDebuggerRequest = {};
    /**
     * Pauses page execution. Can be resumed using generic Runtime.runIfWaitingForDebugger.
     * @response `Page.waitForDebugger`
     */
    export type WaitForDebuggerResponse = {};
    /**
     * Intercept file chooser requests and transfer control to protocol clients.
     * When file chooser interception is enabled, native file chooser dialog is not shown.
     * Instead, a protocol event `Page.fileChooserOpened` is emitted.
     * @request `Page.setInterceptFileChooserDialog`
     */
    export type SetInterceptFileChooserDialogRequest = {
      enabled: boolean;
    };
    /**
     * Intercept file chooser requests and transfer control to protocol clients.
     * When file chooser interception is enabled, native file chooser dialog is not shown.
     * Instead, a protocol event `Page.fileChooserOpened` is emitted.
     * @response `Page.setInterceptFileChooserDialog`
     */
    export type SetInterceptFileChooserDialogResponse = {};
    /**
     * Enable/disable prerendering manually.
     *
     * This command is a short-term solution for https://crbug.com/1440085.
     * See https://docs.google.com/document/d/12HVmFxYj5Jc-eJr5OmWsa2bqTJsbgGLKI6ZIyx0_wpA
     * for more details.
     *
     * TODO(https://crbug.com/1440085): Remove this once Puppeteer supports tab targets.
     * @request `Page.setPrerenderingAllowed`
     */
    export type SetPrerenderingAllowedRequest = {
      isAllowed: boolean;
    };
    /**
     * Enable/disable prerendering manually.
     *
     * This command is a short-term solution for https://crbug.com/1440085.
     * See https://docs.google.com/document/d/12HVmFxYj5Jc-eJr5OmWsa2bqTJsbgGLKI6ZIyx0_wpA
     * for more details.
     *
     * TODO(https://crbug.com/1440085): Remove this once Puppeteer supports tab targets.
     * @response `Page.setPrerenderingAllowed`
     */
    export type SetPrerenderingAllowedResponse = {};
  }
  export namespace Performance {
    /**
     * Run-time execution metric.
     */
    export type Metric = {
      /**
       * Metric name.
       */
      name: string;
      /**
       * Metric value.
       */
      value: number;
    };
    /**
     * Current values of the metrics.
     * @event `Performance.metrics`
     */
    export type MetricsEvent = {
      /**
       * Current values of the metrics.
       */
      metrics: Metric[];
      /**
       * Timestamp title.
       */
      title: string;
    };
    /**
     * Disable collecting and reporting metrics.
     * @request `Performance.disable`
     */
    export type DisableRequest = {};
    /**
     * Disable collecting and reporting metrics.
     * @response `Performance.disable`
     */
    export type DisableResponse = {};
    /**
     * Enable collecting and reporting metrics.
     * @request `Performance.enable`
     */
    export type EnableRequest = {
      /**
       * Time domain to use for collecting and reporting duration metrics.
       */
      timeDomain?: "timeTicks" | "threadTicks" | undefined;
    };
    /**
     * Enable collecting and reporting metrics.
     * @response `Performance.enable`
     */
    export type EnableResponse = {};
    /**
     * Sets time domain to use for collecting and reporting duration metrics.
     * Note that this must be called before enabling metrics collection. Calling
     * this method while metrics collection is enabled returns an error.
     * @request `Performance.setTimeDomain`
     */
    export type SetTimeDomainRequest = {
      /**
       * Time domain
       */
      timeDomain: "timeTicks" | "threadTicks";
    };
    /**
     * Sets time domain to use for collecting and reporting duration metrics.
     * Note that this must be called before enabling metrics collection. Calling
     * this method while metrics collection is enabled returns an error.
     * @response `Performance.setTimeDomain`
     */
    export type SetTimeDomainResponse = {};
    /**
     * Retrieve current values of run-time metrics.
     * @request `Performance.getMetrics`
     */
    export type GetMetricsRequest = {};
    /**
     * Retrieve current values of run-time metrics.
     * @response `Performance.getMetrics`
     */
    export type GetMetricsResponse = {
      /**
       * Current values for run-time metrics.
       */
      metrics: Metric[];
    };
  }
  export namespace PerformanceTimeline {
    /**
     * See https://github.com/WICG/LargestContentfulPaint and largest_contentful_paint.idl
     */
    export type LargestContentfulPaint = {
      renderTime: Network.TimeSinceEpoch;
      loadTime: Network.TimeSinceEpoch;
      /**
       * The number of pixels being painted.
       */
      size: number;
      /**
       * The id attribute of the element, if available.
       */
      elementId?: string | undefined;
      /**
       * The URL of the image (may be trimmed).
       */
      url?: string | undefined;
      nodeId?: DOM.BackendNodeId | undefined;
    };
    export type LayoutShiftAttribution = {
      previousRect: DOM.Rect;
      currentRect: DOM.Rect;
      nodeId?: DOM.BackendNodeId | undefined;
    };
    /**
     * See https://wicg.github.io/layout-instability/#sec-layout-shift and layout_shift.idl
     */
    export type LayoutShift = {
      /**
       * Score increment produced by this event.
       */
      value: number;
      hadRecentInput: boolean;
      lastInputTime: Network.TimeSinceEpoch;
      sources: LayoutShiftAttribution[];
    };
    export type TimelineEvent = {
      /**
       * Identifies the frame that this event is related to. Empty for non-frame targets.
       */
      frameId: Page.FrameId;
      /**
       * The event type, as specified in https://w3c.github.io/performance-timeline/#dom-performanceentry-entrytype
       * This determines which of the optional "details" fiedls is present.
       */
      type: string;
      /**
       * Name may be empty depending on the type.
       */
      name: string;
      /**
       * Time in seconds since Epoch, monotonically increasing within document lifetime.
       */
      time: Network.TimeSinceEpoch;
      /**
       * Event duration, if applicable.
       */
      duration?: number | undefined;
      lcpDetails?: LargestContentfulPaint | undefined;
      layoutShiftDetails?: LayoutShift | undefined;
    };
    /**
     * Sent when a performance timeline event is added. See reportPerformanceTimeline method.
     * @event `PerformanceTimeline.timelineEventAdded`
     */
    export type TimelineEventAddedEvent = {
      event: TimelineEvent;
    };
    /**
     * Previously buffered events would be reported before method returns.
     * See also: timelineEventAdded
     * @request `PerformanceTimeline.enable`
     */
    export type EnableRequest = {
      /**
       * The types of event to report, as specified in
       * https://w3c.github.io/performance-timeline/#dom-performanceentry-entrytype
       * The specified filter overrides any previous filters, passing empty
       * filter disables recording.
       * Note that not all types exposed to the web platform are currently supported.
       */
      eventTypes: string[];
    };
    /**
     * Previously buffered events would be reported before method returns.
     * See also: timelineEventAdded
     * @response `PerformanceTimeline.enable`
     */
    export type EnableResponse = {};
  }
  export namespace Preload {
    /**
     * Unique id
     */
    export type RuleSetId = string;
    /**
     * Corresponds to SpeculationRuleSet
     */
    export type RuleSet = {
      id: RuleSetId;
      /**
       * Identifies a document which the rule set is associated with.
       */
      loaderId: Network.LoaderId;
      /**
       * Source text of JSON representing the rule set. If it comes from
       * `<script>` tag, it is the textContent of the node. Note that it is
       * a JSON for valid case.
       *
       * See also:
       * - https://wicg.github.io/nav-speculation/speculation-rules.html
       * - https://github.com/WICG/nav-speculation/blob/main/triggers.md
       */
      sourceText: string;
      /**
       * A speculation rule set is either added through an inline
       * `<script>` tag or through an external resource via the
       * 'Speculation-Rules' HTTP header. For the first case, we include
       * the BackendNodeId of the relevant `<script>` tag. For the second
       * case, we include the external URL where the rule set was loaded
       * from, and also RequestId if Network domain is enabled.
       *
       * See also:
       * - https://wicg.github.io/nav-speculation/speculation-rules.html#speculation-rules-script
       * - https://wicg.github.io/nav-speculation/speculation-rules.html#speculation-rules-header
       */
      backendNodeId?: DOM.BackendNodeId | undefined;
      url?: string | undefined;
      requestId?: Network.RequestId | undefined;
      /**
       * Error information
       * `errorMessage` is null iff `errorType` is null.
       */
      errorType?: RuleSetErrorType | undefined;
      /**
       * TODO(https://crbug.com/1425354): Replace this property with structured error.
       */
      errorMessage?: string | undefined;
    };
    export type RuleSetErrorType = "SourceIsNotJsonObject" | "InvalidRulesSkipped";
    /**
     * The type of preloading attempted. It corresponds to
     * mojom::SpeculationAction (although PrefetchWithSubresources is omitted as it
     * isn't being used by clients).
     */
    export type SpeculationAction = "Prefetch" | "Prerender";
    /**
     * Corresponds to mojom::SpeculationTargetHint.
     * See https://github.com/WICG/nav-speculation/blob/main/triggers.md#window-name-targeting-hints
     */
    export type SpeculationTargetHint = "Blank" | "Self";
    /**
     * A key that identifies a preloading attempt.
     *
     * The url used is the url specified by the trigger (i.e. the initial URL), and
     * not the final url that is navigated to. For example, prerendering allows
     * same-origin main frame navigations during the attempt, but the attempt is
     * still keyed with the initial URL.
     */
    export type PreloadingAttemptKey = {
      loaderId: Network.LoaderId;
      action: SpeculationAction;
      url: string;
      targetHint?: SpeculationTargetHint | undefined;
    };
    /**
     * Lists sources for a preloading attempt, specifically the ids of rule sets
     * that had a speculation rule that triggered the attempt, and the
     * BackendNodeIds of <a href> or <area href> elements that triggered the
     * attempt (in the case of attempts triggered by a document rule). It is
     * possible for mulitple rule sets and links to trigger a single attempt.
     */
    export type PreloadingAttemptSource = {
      key: PreloadingAttemptKey;
      ruleSetIds: RuleSetId[];
      nodeIds: DOM.BackendNodeId[];
    };
    /**
     * List of FinalStatus reasons for Prerender2.
     */
    export type PrerenderFinalStatus =
      | "Activated"
      | "Destroyed"
      | "LowEndDevice"
      | "InvalidSchemeRedirect"
      | "InvalidSchemeNavigation"
      | "NavigationRequestBlockedByCsp"
      | "MainFrameNavigation"
      | "MojoBinderPolicy"
      | "RendererProcessCrashed"
      | "RendererProcessKilled"
      | "Download"
      | "TriggerDestroyed"
      | "NavigationNotCommitted"
      | "NavigationBadHttpStatus"
      | "ClientCertRequested"
      | "NavigationRequestNetworkError"
      | "CancelAllHostsForTesting"
      | "DidFailLoad"
      | "Stop"
      | "SslCertificateError"
      | "LoginAuthRequested"
      | "UaChangeRequiresReload"
      | "BlockedByClient"
      | "AudioOutputDeviceRequested"
      | "MixedContent"
      | "TriggerBackgrounded"
      | "MemoryLimitExceeded"
      | "DataSaverEnabled"
      | "TriggerUrlHasEffectiveUrl"
      | "ActivatedBeforeStarted"
      | "InactivePageRestriction"
      | "StartFailed"
      | "TimeoutBackgrounded"
      | "CrossSiteRedirectInInitialNavigation"
      | "CrossSiteNavigationInInitialNavigation"
      | "SameSiteCrossOriginRedirectNotOptInInInitialNavigation"
      | "SameSiteCrossOriginNavigationNotOptInInInitialNavigation"
      | "ActivationNavigationParameterMismatch"
      | "ActivatedInBackground"
      | "EmbedderHostDisallowed"
      | "ActivationNavigationDestroyedBeforeSuccess"
      | "TabClosedByUserGesture"
      | "TabClosedWithoutUserGesture"
      | "PrimaryMainFrameRendererProcessCrashed"
      | "PrimaryMainFrameRendererProcessKilled"
      | "ActivationFramePolicyNotCompatible"
      | "PreloadingDisabled"
      | "BatterySaverEnabled"
      | "ActivatedDuringMainFrameNavigation"
      | "PreloadingUnsupportedByWebContents"
      | "CrossSiteRedirectInMainFrameNavigation"
      | "CrossSiteNavigationInMainFrameNavigation"
      | "SameSiteCrossOriginRedirectNotOptInInMainFrameNavigation"
      | "SameSiteCrossOriginNavigationNotOptInInMainFrameNavigation"
      | "MemoryPressureOnTrigger"
      | "MemoryPressureAfterTriggered"
      | "PrerenderingDisabledByDevTools"
      | "SpeculationRuleRemoved"
      | "ActivatedWithAuxiliaryBrowsingContexts"
      | "MaxNumOfRunningEagerPrerendersExceeded"
      | "MaxNumOfRunningNonEagerPrerendersExceeded"
      | "MaxNumOfRunningEmbedderPrerendersExceeded"
      | "PrerenderingUrlHasEffectiveUrl"
      | "RedirectedPrerenderingUrlHasEffectiveUrl"
      | "ActivationUrlHasEffectiveUrl";
    /**
     * Preloading status values, see also PreloadingTriggeringOutcome. This
     * status is shared by prefetchStatusUpdated and prerenderStatusUpdated.
     */
    export type PreloadingStatus = "Pending" | "Running" | "Ready" | "Success" | "Failure" | "NotSupported";
    /**
     * TODO(https://crbug.com/1384419): revisit the list of PrefetchStatus and
     * filter out the ones that aren't necessary to the developers.
     */
    export type PrefetchStatus =
      | "PrefetchAllowed"
      | "PrefetchFailedIneligibleRedirect"
      | "PrefetchFailedInvalidRedirect"
      | "PrefetchFailedMIMENotSupported"
      | "PrefetchFailedNetError"
      | "PrefetchFailedNon2XX"
      | "PrefetchFailedPerPageLimitExceeded"
      | "PrefetchEvictedAfterCandidateRemoved"
      | "PrefetchEvictedForNewerPrefetch"
      | "PrefetchHeldback"
      | "PrefetchIneligibleRetryAfter"
      | "PrefetchIsPrivacyDecoy"
      | "PrefetchIsStale"
      | "PrefetchNotEligibleBrowserContextOffTheRecord"
      | "PrefetchNotEligibleDataSaverEnabled"
      | "PrefetchNotEligibleExistingProxy"
      | "PrefetchNotEligibleHostIsNonUnique"
      | "PrefetchNotEligibleNonDefaultStoragePartition"
      | "PrefetchNotEligibleSameSiteCrossOriginPrefetchRequiredProxy"
      | "PrefetchNotEligibleSchemeIsNotHttps"
      | "PrefetchNotEligibleUserHasCookies"
      | "PrefetchNotEligibleUserHasServiceWorker"
      | "PrefetchNotEligibleBatterySaverEnabled"
      | "PrefetchNotEligiblePreloadingDisabled"
      | "PrefetchNotFinishedInTime"
      | "PrefetchNotStarted"
      | "PrefetchNotUsedCookiesChanged"
      | "PrefetchProxyNotAvailable"
      | "PrefetchResponseUsed"
      | "PrefetchSuccessfulButNotUsed"
      | "PrefetchNotUsedProbeFailed";
    /**
     * Information of headers to be displayed when the header mismatch occurred.
     */
    export type PrerenderMismatchedHeaders = {
      headerName: string;
      initialValue?: string | undefined;
      activationValue?: string | undefined;
    };
    /**
     * Upsert. Currently, it is only emitted when a rule set added.
     * @event `Preload.ruleSetUpdated`
     */
    export type RuleSetUpdatedEvent = {
      ruleSet: RuleSet;
    };
    /**
     * undefined
     * @event `Preload.ruleSetRemoved`
     */
    export type RuleSetRemovedEvent = {
      id: RuleSetId;
    };
    /**
     * Fired when a preload enabled state is updated.
     * @event `Preload.preloadEnabledStateUpdated`
     */
    export type PreloadEnabledStateUpdatedEvent = {
      disabledByPreference: boolean;
      disabledByDataSaver: boolean;
      disabledByBatterySaver: boolean;
      disabledByHoldbackPrefetchSpeculationRules: boolean;
      disabledByHoldbackPrerenderSpeculationRules: boolean;
    };
    /**
     * Fired when a prefetch attempt is updated.
     * @event `Preload.prefetchStatusUpdated`
     */
    export type PrefetchStatusUpdatedEvent = {
      key: PreloadingAttemptKey;
      /**
       * The frame id of the frame initiating prefetch.
       */
      initiatingFrameId: Page.FrameId;
      prefetchUrl: string;
      status: PreloadingStatus;
      prefetchStatus: PrefetchStatus;
      requestId: Network.RequestId;
    };
    /**
     * Fired when a prerender attempt is updated.
     * @event `Preload.prerenderStatusUpdated`
     */
    export type PrerenderStatusUpdatedEvent = {
      key: PreloadingAttemptKey;
      status: PreloadingStatus;
      prerenderStatus?: PrerenderFinalStatus | undefined;
      /**
       * This is used to give users more information about the name of Mojo interface
       * that is incompatible with prerender and has caused the cancellation of the attempt.
       */
      disallowedMojoInterface?: string | undefined;
      mismatchedHeaders?: PrerenderMismatchedHeaders[] | undefined;
    };
    /**
     * Send a list of sources for all preloading attempts in a document.
     * @event `Preload.preloadingAttemptSourcesUpdated`
     */
    export type PreloadingAttemptSourcesUpdatedEvent = {
      loaderId: Network.LoaderId;
      preloadingAttemptSources: PreloadingAttemptSource[];
    };
    /**
     * undefined
     * @request `Preload.enable`
     */
    export type EnableRequest = {};
    /**
     * undefined
     * @response `Preload.enable`
     */
    export type EnableResponse = {};
    /**
     * undefined
     * @request `Preload.disable`
     */
    export type DisableRequest = {};
    /**
     * undefined
     * @response `Preload.disable`
     */
    export type DisableResponse = {};
  }
  export namespace Schema {
    /**
     * Description of the protocol domain.
     */
    export type Domain = {
      /**
       * Domain name.
       */
      name: string;
      /**
       * Domain version.
       */
      version: string;
    };
    /**
     * Returns supported domains.
     * @request `Schema.getDomains`
     */
    export type GetDomainsRequest = {};
    /**
     * Returns supported domains.
     * @response `Schema.getDomains`
     */
    export type GetDomainsResponse = {
      /**
       * List of supported domains.
       */
      domains: Domain[];
    };
  }
  export namespace Security {
    /**
     * An internal certificate ID value.
     */
    export type CertificateId = number;
    /**
     * A description of mixed content (HTTP resources on HTTPS pages), as defined by
     * https://www.w3.org/TR/mixed-content/#categories
     */
    export type MixedContentType = "blockable" | "optionally-blockable" | "none";
    /**
     * The security level of a page or resource.
     */
    export type SecurityState = "unknown" | "neutral" | "insecure" | "secure" | "info" | "insecure-broken";
    /**
     * Details about the security state of the page certificate.
     */
    export type CertificateSecurityState = {
      /**
       * Protocol name (e.g. "TLS 1.2" or "QUIC").
       */
      protocol: string;
      /**
       * Key Exchange used by the connection, or the empty string if not applicable.
       */
      keyExchange: string;
      /**
       * (EC)DH group used by the connection, if applicable.
       */
      keyExchangeGroup?: string | undefined;
      /**
       * Cipher name.
       */
      cipher: string;
      /**
       * TLS MAC. Note that AEAD ciphers do not have separate MACs.
       */
      mac?: string | undefined;
      /**
       * Page certificate.
       */
      certificate: string[];
      /**
       * Certificate subject name.
       */
      subjectName: string;
      /**
       * Name of the issuing CA.
       */
      issuer: string;
      /**
       * Certificate valid from date.
       */
      validFrom: Network.TimeSinceEpoch;
      /**
       * Certificate valid to (expiration) date
       */
      validTo: Network.TimeSinceEpoch;
      /**
       * The highest priority network error code, if the certificate has an error.
       */
      certificateNetworkError?: string | undefined;
      /**
       * True if the certificate uses a weak signature aglorithm.
       */
      certificateHasWeakSignature: boolean;
      /**
       * True if the certificate has a SHA1 signature in the chain.
       */
      certificateHasSha1Signature: boolean;
      /**
       * True if modern SSL
       */
      modernSSL: boolean;
      /**
       * True if the connection is using an obsolete SSL protocol.
       */
      obsoleteSslProtocol: boolean;
      /**
       * True if the connection is using an obsolete SSL key exchange.
       */
      obsoleteSslKeyExchange: boolean;
      /**
       * True if the connection is using an obsolete SSL cipher.
       */
      obsoleteSslCipher: boolean;
      /**
       * True if the connection is using an obsolete SSL signature.
       */
      obsoleteSslSignature: boolean;
    };
    export type SafetyTipStatus = "badReputation" | "lookalike";
    export type SafetyTipInfo = {
      /**
       * Describes whether the page triggers any safety tips or reputation warnings. Default is unknown.
       */
      safetyTipStatus: SafetyTipStatus;
      /**
       * The URL the safety tip suggested ("Did you mean?"). Only filled in for lookalike matches.
       */
      safeUrl?: string | undefined;
    };
    /**
     * Security state information about the page.
     */
    export type VisibleSecurityState = {
      /**
       * The security level of the page.
       */
      securityState: SecurityState;
      /**
       * Security state details about the page certificate.
       */
      certificateSecurityState?: CertificateSecurityState | undefined;
      /**
       * The type of Safety Tip triggered on the page. Note that this field will be set even if the Safety Tip UI was not actually shown.
       */
      safetyTipInfo?: SafetyTipInfo | undefined;
      /**
       * Array of security state issues ids.
       */
      securityStateIssueIds: string[];
    };
    /**
     * An explanation of an factor contributing to the security state.
     */
    export type SecurityStateExplanation = {
      /**
       * Security state representing the severity of the factor being explained.
       */
      securityState: SecurityState;
      /**
       * Title describing the type of factor.
       */
      title: string;
      /**
       * Short phrase describing the type of factor.
       */
      summary: string;
      /**
       * Full text explanation of the factor.
       */
      description: string;
      /**
       * The type of mixed content described by the explanation.
       */
      mixedContentType: MixedContentType;
      /**
       * Page certificate.
       */
      certificate: string[];
      /**
       * Recommendations to fix any issues.
       */
      recommendations?: string[] | undefined;
    };
    /**
     * Information about insecure content on the page.
     */
    export type InsecureContentStatus = {
      /**
       * Always false.
       */
      ranMixedContent: boolean;
      /**
       * Always false.
       */
      displayedMixedContent: boolean;
      /**
       * Always false.
       */
      containedMixedForm: boolean;
      /**
       * Always false.
       */
      ranContentWithCertErrors: boolean;
      /**
       * Always false.
       */
      displayedContentWithCertErrors: boolean;
      /**
       * Always set to unknown.
       */
      ranInsecureContentStyle: SecurityState;
      /**
       * Always set to unknown.
       */
      displayedInsecureContentStyle: SecurityState;
    };
    /**
     * The action to take when a certificate error occurs. continue will continue processing the
     * request and cancel will cancel the request.
     */
    export type CertificateErrorAction = "continue" | "cancel";
    /**
     * There is a certificate error. If overriding certificate errors is enabled, then it should be
     * handled with the `handleCertificateError` command. Note: this event does not fire if the
     * certificate error has been allowed internally. Only one client per target should override
     * certificate errors at the same time.
     * @event `Security.certificateError`
     */
    export type CertificateErrorEvent = {
      /**
       * The ID of the event.
       */
      eventId: number;
      /**
       * The type of the error.
       */
      errorType: string;
      /**
       * The url that was requested.
       */
      requestURL: string;
    };
    /**
     * The security state of the page changed.
     * @event `Security.visibleSecurityStateChanged`
     */
    export type VisibleSecurityStateChangedEvent = {
      /**
       * Security state information about the page.
       */
      visibleSecurityState: VisibleSecurityState;
    };
    /**
     * The security state of the page changed. No longer being sent.
     * @event `Security.securityStateChanged`
     */
    export type SecurityStateChangedEvent = {
      /**
       * Security state.
       */
      securityState: SecurityState;
      /**
       * True if the page was loaded over cryptographic transport such as HTTPS.
       */
      schemeIsCryptographic: boolean;
      /**
       * Previously a list of explanations for the security state. Now always
       * empty.
       */
      explanations: SecurityStateExplanation[];
      /**
       * Information about insecure content on the page.
       */
      insecureContentStatus: InsecureContentStatus;
      /**
       * Overrides user-visible description of the state. Always omitted.
       */
      summary?: string | undefined;
    };
    /**
     * Disables tracking security state changes.
     * @request `Security.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables tracking security state changes.
     * @response `Security.disable`
     */
    export type DisableResponse = {};
    /**
     * Enables tracking security state changes.
     * @request `Security.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables tracking security state changes.
     * @response `Security.enable`
     */
    export type EnableResponse = {};
    /**
     * Enable/disable whether all certificate errors should be ignored.
     * @request `Security.setIgnoreCertificateErrors`
     */
    export type SetIgnoreCertificateErrorsRequest = {
      /**
       * If true, all certificate errors will be ignored.
       */
      ignore: boolean;
    };
    /**
     * Enable/disable whether all certificate errors should be ignored.
     * @response `Security.setIgnoreCertificateErrors`
     */
    export type SetIgnoreCertificateErrorsResponse = {};
    /**
     * Handles a certificate error that fired a certificateError event.
     * @request `Security.handleCertificateError`
     */
    export type HandleCertificateErrorRequest = {
      /**
       * The ID of the event.
       */
      eventId: number;
      /**
       * The action to take on the certificate error.
       */
      action: CertificateErrorAction;
    };
    /**
     * Handles a certificate error that fired a certificateError event.
     * @response `Security.handleCertificateError`
     */
    export type HandleCertificateErrorResponse = {};
    /**
     * Enable/disable overriding certificate errors. If enabled, all certificate error events need to
     * be handled by the DevTools client and should be answered with `handleCertificateError` commands.
     * @request `Security.setOverrideCertificateErrors`
     */
    export type SetOverrideCertificateErrorsRequest = {
      /**
       * If true, certificate errors will be overridden.
       */
      override: boolean;
    };
    /**
     * Enable/disable overriding certificate errors. If enabled, all certificate error events need to
     * be handled by the DevTools client and should be answered with `handleCertificateError` commands.
     * @response `Security.setOverrideCertificateErrors`
     */
    export type SetOverrideCertificateErrorsResponse = {};
  }
  export namespace ServiceWorker {
    export type RegistrationID = string;
    /**
     * ServiceWorker registration.
     */
    export type ServiceWorkerRegistration = {
      registrationId: RegistrationID;
      scopeURL: string;
      isDeleted: boolean;
    };
    export type ServiceWorkerVersionRunningStatus = "stopped" | "starting" | "running" | "stopping";
    export type ServiceWorkerVersionStatus =
      | "new"
      | "installing"
      | "installed"
      | "activating"
      | "activated"
      | "redundant";
    /**
     * ServiceWorker version.
     */
    export type ServiceWorkerVersion = {
      versionId: string;
      registrationId: RegistrationID;
      scriptURL: string;
      runningStatus: ServiceWorkerVersionRunningStatus;
      status: ServiceWorkerVersionStatus;
      /**
       * The Last-Modified header value of the main script.
       */
      scriptLastModified?: number | undefined;
      /**
       * The time at which the response headers of the main script were received from the server.
       * For cached script it is the last time the cache entry was validated.
       */
      scriptResponseTime?: number | undefined;
      controlledClients?: Target.TargetID[] | undefined;
      targetId?: Target.TargetID | undefined;
      routerRules?: string | undefined;
    };
    /**
     * ServiceWorker error message.
     */
    export type ServiceWorkerErrorMessage = {
      errorMessage: string;
      registrationId: RegistrationID;
      versionId: string;
      sourceURL: string;
      lineNumber: number;
      columnNumber: number;
    };
    /**
     * undefined
     * @event `ServiceWorker.workerErrorReported`
     */
    export type WorkerErrorReportedEvent = {
      errorMessage: ServiceWorkerErrorMessage;
    };
    /**
     * undefined
     * @event `ServiceWorker.workerRegistrationUpdated`
     */
    export type WorkerRegistrationUpdatedEvent = {
      registrations: ServiceWorkerRegistration[];
    };
    /**
     * undefined
     * @event `ServiceWorker.workerVersionUpdated`
     */
    export type WorkerVersionUpdatedEvent = {
      versions: ServiceWorkerVersion[];
    };
    /**
     * undefined
     * @request `ServiceWorker.deliverPushMessage`
     */
    export type DeliverPushMessageRequest = {
      origin: string;
      registrationId: RegistrationID;
      data: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.deliverPushMessage`
     */
    export type DeliverPushMessageResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.disable`
     */
    export type DisableRequest = {};
    /**
     * undefined
     * @response `ServiceWorker.disable`
     */
    export type DisableResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.dispatchSyncEvent`
     */
    export type DispatchSyncEventRequest = {
      origin: string;
      registrationId: RegistrationID;
      tag: string;
      lastChance: boolean;
    };
    /**
     * undefined
     * @response `ServiceWorker.dispatchSyncEvent`
     */
    export type DispatchSyncEventResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.dispatchPeriodicSyncEvent`
     */
    export type DispatchPeriodicSyncEventRequest = {
      origin: string;
      registrationId: RegistrationID;
      tag: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.dispatchPeriodicSyncEvent`
     */
    export type DispatchPeriodicSyncEventResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.enable`
     */
    export type EnableRequest = {};
    /**
     * undefined
     * @response `ServiceWorker.enable`
     */
    export type EnableResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.inspectWorker`
     */
    export type InspectWorkerRequest = {
      versionId: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.inspectWorker`
     */
    export type InspectWorkerResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.setForceUpdateOnPageLoad`
     */
    export type SetForceUpdateOnPageLoadRequest = {
      forceUpdateOnPageLoad: boolean;
    };
    /**
     * undefined
     * @response `ServiceWorker.setForceUpdateOnPageLoad`
     */
    export type SetForceUpdateOnPageLoadResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.skipWaiting`
     */
    export type SkipWaitingRequest = {
      scopeURL: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.skipWaiting`
     */
    export type SkipWaitingResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.startWorker`
     */
    export type StartWorkerRequest = {
      scopeURL: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.startWorker`
     */
    export type StartWorkerResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.stopAllWorkers`
     */
    export type StopAllWorkersRequest = {};
    /**
     * undefined
     * @response `ServiceWorker.stopAllWorkers`
     */
    export type StopAllWorkersResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.stopWorker`
     */
    export type StopWorkerRequest = {
      versionId: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.stopWorker`
     */
    export type StopWorkerResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.unregister`
     */
    export type UnregisterRequest = {
      scopeURL: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.unregister`
     */
    export type UnregisterResponse = {};
    /**
     * undefined
     * @request `ServiceWorker.updateRegistration`
     */
    export type UpdateRegistrationRequest = {
      scopeURL: string;
    };
    /**
     * undefined
     * @response `ServiceWorker.updateRegistration`
     */
    export type UpdateRegistrationResponse = {};
  }
  export namespace Storage {
    export type SerializedStorageKey = string;
    /**
     * Enum of possible storage types.
     */
    export type StorageType =
      | "appcache"
      | "cookies"
      | "file_systems"
      | "indexeddb"
      | "local_storage"
      | "shader_cache"
      | "websql"
      | "service_workers"
      | "cache_storage"
      | "interest_groups"
      | "shared_storage"
      | "storage_buckets"
      | "all"
      | "other";
    /**
     * Usage for a storage type.
     */
    export type UsageForType = {
      /**
       * Name of storage type.
       */
      storageType: StorageType;
      /**
       * Storage usage (bytes).
       */
      usage: number;
    };
    /**
     * Pair of issuer origin and number of available (signed, but not used) Trust
     * Tokens from that issuer.
     */
    export type TrustTokens = {
      issuerOrigin: string;
      count: number;
    };
    /**
     * Enum of interest group access types.
     */
    export type InterestGroupAccessType =
      | "join"
      | "leave"
      | "update"
      | "loaded"
      | "bid"
      | "win"
      | "additionalBid"
      | "additionalBidWin"
      | "clear";
    /**
     * Ad advertising element inside an interest group.
     */
    export type InterestGroupAd = {
      renderURL: string;
      metadata?: string | undefined;
    };
    /**
     * The full details of an interest group.
     */
    export type InterestGroupDetails = {
      ownerOrigin: string;
      name: string;
      expirationTime: Network.TimeSinceEpoch;
      joiningOrigin: string;
      biddingLogicURL?: string | undefined;
      biddingWasmHelperURL?: string | undefined;
      updateURL?: string | undefined;
      trustedBiddingSignalsURL?: string | undefined;
      trustedBiddingSignalsKeys: string[];
      userBiddingSignals?: string | undefined;
      ads: InterestGroupAd[];
      adComponents: InterestGroupAd[];
    };
    /**
     * Enum of shared storage access types.
     */
    export type SharedStorageAccessType =
      | "documentAddModule"
      | "documentSelectURL"
      | "documentRun"
      | "documentSet"
      | "documentAppend"
      | "documentDelete"
      | "documentClear"
      | "workletSet"
      | "workletAppend"
      | "workletDelete"
      | "workletClear"
      | "workletGet"
      | "workletKeys"
      | "workletEntries"
      | "workletLength"
      | "workletRemainingBudget";
    /**
     * Struct for a single key-value pair in an origin's shared storage.
     */
    export type SharedStorageEntry = {
      key: string;
      value: string;
    };
    /**
     * Details for an origin's shared storage.
     */
    export type SharedStorageMetadata = {
      creationTime: Network.TimeSinceEpoch;
      length: number;
      remainingBudget: number;
    };
    /**
     * Pair of reporting metadata details for a candidate URL for `selectURL()`.
     */
    export type SharedStorageReportingMetadata = {
      eventType: string;
      reportingUrl: string;
    };
    /**
     * Bundles a candidate URL with its reporting metadata.
     */
    export type SharedStorageUrlWithMetadata = {
      /**
       * Spec of candidate URL.
       */
      url: string;
      /**
       * Any associated reporting metadata.
       */
      reportingMetadata: SharedStorageReportingMetadata[];
    };
    /**
     * Bundles the parameters for shared storage access events whose
     * presence/absence can vary according to SharedStorageAccessType.
     */
    export type SharedStorageAccessParams = {
      /**
       * Spec of the module script URL.
       * Present only for SharedStorageAccessType.documentAddModule.
       */
      scriptSourceUrl?: string | undefined;
      /**
       * Name of the registered operation to be run.
       * Present only for SharedStorageAccessType.documentRun and
       * SharedStorageAccessType.documentSelectURL.
       */
      operationName?: string | undefined;
      /**
       * The operation's serialized data in bytes (converted to a string).
       * Present only for SharedStorageAccessType.documentRun and
       * SharedStorageAccessType.documentSelectURL.
       */
      serializedData?: string | undefined;
      /**
       * Array of candidate URLs' specs, along with any associated metadata.
       * Present only for SharedStorageAccessType.documentSelectURL.
       */
      urlsWithMetadata?: SharedStorageUrlWithMetadata[] | undefined;
      /**
       * Key for a specific entry in an origin's shared storage.
       * Present only for SharedStorageAccessType.documentSet,
       * SharedStorageAccessType.documentAppend,
       * SharedStorageAccessType.documentDelete,
       * SharedStorageAccessType.workletSet,
       * SharedStorageAccessType.workletAppend,
       * SharedStorageAccessType.workletDelete, and
       * SharedStorageAccessType.workletGet.
       */
      key?: string | undefined;
      /**
       * Value for a specific entry in an origin's shared storage.
       * Present only for SharedStorageAccessType.documentSet,
       * SharedStorageAccessType.documentAppend,
       * SharedStorageAccessType.workletSet, and
       * SharedStorageAccessType.workletAppend.
       */
      value?: string | undefined;
      /**
       * Whether or not to set an entry for a key if that key is already present.
       * Present only for SharedStorageAccessType.documentSet and
       * SharedStorageAccessType.workletSet.
       */
      ignoreIfPresent?: boolean | undefined;
    };
    export type StorageBucketsDurability = "relaxed" | "strict";
    export type StorageBucket = {
      storageKey: SerializedStorageKey;
      /**
       * If not specified, it is the default bucket of the storageKey.
       */
      name?: string | undefined;
    };
    export type StorageBucketInfo = {
      bucket: StorageBucket;
      id: string;
      expiration: Network.TimeSinceEpoch;
      /**
       * Storage quota (bytes).
       */
      quota: number;
      persistent: boolean;
      durability: StorageBucketsDurability;
    };
    export type AttributionReportingSourceType = "navigation" | "event";
    export type UnsignedInt64AsBase10 = string;
    export type UnsignedInt128AsBase16 = string;
    export type SignedInt64AsBase10 = string;
    export type AttributionReportingFilterDataEntry = {
      key: string;
      values: string[];
    };
    export type AttributionReportingFilterConfig = {
      filterValues: AttributionReportingFilterDataEntry[];
      /**
       * duration in seconds
       */
      lookbackWindow?: number | undefined;
    };
    export type AttributionReportingFilterPair = {
      filters: AttributionReportingFilterConfig[];
      notFilters: AttributionReportingFilterConfig[];
    };
    export type AttributionReportingAggregationKeysEntry = {
      key: string;
      value: UnsignedInt128AsBase16;
    };
    export type AttributionReportingEventReportWindows = {
      /**
       * duration in seconds
       */
      start: number;
      /**
       * duration in seconds
       */
      ends: number[];
    };
    export type AttributionReportingTriggerSpec = {
      /**
       * number instead of integer because not all uint32 can be represented by
       * int
       */
      triggerData: number[];
      eventReportWindows: AttributionReportingEventReportWindows;
    };
    export type AttributionReportingTriggerDataMatching = "exact" | "modulus";
    export type AttributionReportingSourceRegistration = {
      time: Network.TimeSinceEpoch;
      /**
       * duration in seconds
       */
      expiry: number;
      triggerSpecs: AttributionReportingTriggerSpec[];
      /**
       * duration in seconds
       */
      aggregatableReportWindow: number;
      type: AttributionReportingSourceType;
      sourceOrigin: string;
      reportingOrigin: string;
      destinationSites: string[];
      eventId: UnsignedInt64AsBase10;
      priority: SignedInt64AsBase10;
      filterData: AttributionReportingFilterDataEntry[];
      aggregationKeys: AttributionReportingAggregationKeysEntry[];
      debugKey?: UnsignedInt64AsBase10 | undefined;
      triggerDataMatching: AttributionReportingTriggerDataMatching;
    };
    export type AttributionReportingSourceRegistrationResult =
      | "success"
      | "internalError"
      | "insufficientSourceCapacity"
      | "insufficientUniqueDestinationCapacity"
      | "excessiveReportingOrigins"
      | "prohibitedByBrowserPolicy"
      | "successNoised"
      | "destinationReportingLimitReached"
      | "destinationGlobalLimitReached"
      | "destinationBothLimitsReached"
      | "reportingOriginsPerSiteLimitReached"
      | "exceedsMaxChannelCapacity";
    export type AttributionReportingSourceRegistrationTimeConfig = "include" | "exclude";
    export type AttributionReportingAggregatableValueEntry = {
      key: string;
      /**
       * number instead of integer because not all uint32 can be represented by
       * int
       */
      value: number;
    };
    export type AttributionReportingEventTriggerData = {
      data: UnsignedInt64AsBase10;
      priority: SignedInt64AsBase10;
      dedupKey?: UnsignedInt64AsBase10 | undefined;
      filters: AttributionReportingFilterPair;
    };
    export type AttributionReportingAggregatableTriggerData = {
      keyPiece: UnsignedInt128AsBase16;
      sourceKeys: string[];
      filters: AttributionReportingFilterPair;
    };
    export type AttributionReportingAggregatableDedupKey = {
      dedupKey?: UnsignedInt64AsBase10 | undefined;
      filters: AttributionReportingFilterPair;
    };
    export type AttributionReportingTriggerRegistration = {
      filters: AttributionReportingFilterPair;
      debugKey?: UnsignedInt64AsBase10 | undefined;
      aggregatableDedupKeys: AttributionReportingAggregatableDedupKey[];
      eventTriggerData: AttributionReportingEventTriggerData[];
      aggregatableTriggerData: AttributionReportingAggregatableTriggerData[];
      aggregatableValues: AttributionReportingAggregatableValueEntry[];
      debugReporting: boolean;
      aggregationCoordinatorOrigin?: string | undefined;
      sourceRegistrationTimeConfig: AttributionReportingSourceRegistrationTimeConfig;
      triggerContextId?: string | undefined;
    };
    export type AttributionReportingEventLevelResult =
      | "success"
      | "successDroppedLowerPriority"
      | "internalError"
      | "noCapacityForAttributionDestination"
      | "noMatchingSources"
      | "deduplicated"
      | "excessiveAttributions"
      | "priorityTooLow"
      | "neverAttributedSource"
      | "excessiveReportingOrigins"
      | "noMatchingSourceFilterData"
      | "prohibitedByBrowserPolicy"
      | "noMatchingConfigurations"
      | "excessiveReports"
      | "falselyAttributedSource"
      | "reportWindowPassed"
      | "notRegistered"
      | "reportWindowNotStarted"
      | "noMatchingTriggerData";
    export type AttributionReportingAggregatableResult =
      | "success"
      | "internalError"
      | "noCapacityForAttributionDestination"
      | "noMatchingSources"
      | "excessiveAttributions"
      | "excessiveReportingOrigins"
      | "noHistograms"
      | "insufficientBudget"
      | "noMatchingSourceFilterData"
      | "notRegistered"
      | "prohibitedByBrowserPolicy"
      | "deduplicated"
      | "reportWindowPassed"
      | "excessiveReports";
    /**
     * A cache's contents have been modified.
     * @event `Storage.cacheStorageContentUpdated`
     */
    export type CacheStorageContentUpdatedEvent = {
      /**
       * Origin to update.
       */
      origin: string;
      /**
       * Storage key to update.
       */
      storageKey: string;
      /**
       * Storage bucket to update.
       */
      bucketId: string;
      /**
       * Name of cache in origin.
       */
      cacheName: string;
    };
    /**
     * A cache has been added/deleted.
     * @event `Storage.cacheStorageListUpdated`
     */
    export type CacheStorageListUpdatedEvent = {
      /**
       * Origin to update.
       */
      origin: string;
      /**
       * Storage key to update.
       */
      storageKey: string;
      /**
       * Storage bucket to update.
       */
      bucketId: string;
    };
    /**
     * The origin's IndexedDB object store has been modified.
     * @event `Storage.indexedDBContentUpdated`
     */
    export type IndexedDBContentUpdatedEvent = {
      /**
       * Origin to update.
       */
      origin: string;
      /**
       * Storage key to update.
       */
      storageKey: string;
      /**
       * Storage bucket to update.
       */
      bucketId: string;
      /**
       * Database to update.
       */
      databaseName: string;
      /**
       * ObjectStore to update.
       */
      objectStoreName: string;
    };
    /**
     * The origin's IndexedDB database list has been modified.
     * @event `Storage.indexedDBListUpdated`
     */
    export type IndexedDBListUpdatedEvent = {
      /**
       * Origin to update.
       */
      origin: string;
      /**
       * Storage key to update.
       */
      storageKey: string;
      /**
       * Storage bucket to update.
       */
      bucketId: string;
    };
    /**
     * One of the interest groups was accessed by the associated page.
     * @event `Storage.interestGroupAccessed`
     */
    export type InterestGroupAccessedEvent = {
      accessTime: Network.TimeSinceEpoch;
      type: InterestGroupAccessType;
      ownerOrigin: string;
      name: string;
    };
    /**
     * Shared storage was accessed by the associated page.
     * The following parameters are included in all events.
     * @event `Storage.sharedStorageAccessed`
     */
    export type SharedStorageAccessedEvent = {
      /**
       * Time of the access.
       */
      accessTime: Network.TimeSinceEpoch;
      /**
       * Enum value indicating the Shared Storage API method invoked.
       */
      type: SharedStorageAccessType;
      /**
       * DevTools Frame Token for the primary frame tree's root.
       */
      mainFrameId: Page.FrameId;
      /**
       * Serialized origin for the context that invoked the Shared Storage API.
       */
      ownerOrigin: string;
      /**
       * The sub-parameters warapped by `params` are all optional and their
       * presence/absence depends on `type`.
       */
      params: SharedStorageAccessParams;
    };
    /**
     * undefined
     * @event `Storage.storageBucketCreatedOrUpdated`
     */
    export type StorageBucketCreatedOrUpdatedEvent = {
      bucketInfo: StorageBucketInfo;
    };
    /**
     * undefined
     * @event `Storage.storageBucketDeleted`
     */
    export type StorageBucketDeletedEvent = {
      bucketId: string;
    };
    /**
     * undefined
     * @event `Storage.attributionReportingSourceRegistered`
     */
    export type AttributionReportingSourceRegisteredEvent = {
      registration: AttributionReportingSourceRegistration;
      result: AttributionReportingSourceRegistrationResult;
    };
    /**
     * undefined
     * @event `Storage.attributionReportingTriggerRegistered`
     */
    export type AttributionReportingTriggerRegisteredEvent = {
      registration: AttributionReportingTriggerRegistration;
      eventLevel: AttributionReportingEventLevelResult;
      aggregatable: AttributionReportingAggregatableResult;
    };
    /**
     * Returns a storage key given a frame id.
     * @request `Storage.getStorageKeyForFrame`
     */
    export type GetStorageKeyForFrameRequest = {
      frameId: Page.FrameId;
    };
    /**
     * Returns a storage key given a frame id.
     * @response `Storage.getStorageKeyForFrame`
     */
    export type GetStorageKeyForFrameResponse = {
      storageKey: SerializedStorageKey;
    };
    /**
     * Clears storage for origin.
     * @request `Storage.clearDataForOrigin`
     */
    export type ClearDataForOriginRequest = {
      /**
       * Security origin.
       */
      origin: string;
      /**
       * Comma separated list of StorageType to clear.
       */
      storageTypes: string;
    };
    /**
     * Clears storage for origin.
     * @response `Storage.clearDataForOrigin`
     */
    export type ClearDataForOriginResponse = {};
    /**
     * Clears storage for storage key.
     * @request `Storage.clearDataForStorageKey`
     */
    export type ClearDataForStorageKeyRequest = {
      /**
       * Storage key.
       */
      storageKey: string;
      /**
       * Comma separated list of StorageType to clear.
       */
      storageTypes: string;
    };
    /**
     * Clears storage for storage key.
     * @response `Storage.clearDataForStorageKey`
     */
    export type ClearDataForStorageKeyResponse = {};
    /**
     * Returns all browser cookies.
     * @request `Storage.getCookies`
     */
    export type GetCookiesRequest = {
      /**
       * Browser context to use when called on the browser endpoint.
       */
      browserContextId?: Browser.BrowserContextID | undefined;
    };
    /**
     * Returns all browser cookies.
     * @response `Storage.getCookies`
     */
    export type GetCookiesResponse = {
      /**
       * Array of cookie objects.
       */
      cookies: Network.Cookie[];
    };
    /**
     * Sets given cookies.
     * @request `Storage.setCookies`
     */
    export type SetCookiesRequest = {
      /**
       * Cookies to be set.
       */
      cookies: Network.CookieParam[];
      /**
       * Browser context to use when called on the browser endpoint.
       */
      browserContextId?: Browser.BrowserContextID | undefined;
    };
    /**
     * Sets given cookies.
     * @response `Storage.setCookies`
     */
    export type SetCookiesResponse = {};
    /**
     * Clears cookies.
     * @request `Storage.clearCookies`
     */
    export type ClearCookiesRequest = {
      /**
       * Browser context to use when called on the browser endpoint.
       */
      browserContextId?: Browser.BrowserContextID | undefined;
    };
    /**
     * Clears cookies.
     * @response `Storage.clearCookies`
     */
    export type ClearCookiesResponse = {};
    /**
     * Returns usage and quota in bytes.
     * @request `Storage.getUsageAndQuota`
     */
    export type GetUsageAndQuotaRequest = {
      /**
       * Security origin.
       */
      origin: string;
    };
    /**
     * Returns usage and quota in bytes.
     * @response `Storage.getUsageAndQuota`
     */
    export type GetUsageAndQuotaResponse = {
      /**
       * Storage usage (bytes).
       */
      usage: number;
      /**
       * Storage quota (bytes).
       */
      quota: number;
      /**
       * Whether or not the origin has an active storage quota override
       */
      overrideActive: boolean;
      /**
       * Storage usage per type (bytes).
       */
      usageBreakdown: UsageForType[];
    };
    /**
     * Override quota for the specified origin
     * @request `Storage.overrideQuotaForOrigin`
     */
    export type OverrideQuotaForOriginRequest = {
      /**
       * Security origin.
       */
      origin: string;
      /**
       * The quota size (in bytes) to override the original quota with.
       * If this is called multiple times, the overridden quota will be equal to
       * the quotaSize provided in the final call. If this is called without
       * specifying a quotaSize, the quota will be reset to the default value for
       * the specified origin. If this is called multiple times with different
       * origins, the override will be maintained for each origin until it is
       * disabled (called without a quotaSize).
       */
      quotaSize?: number | undefined;
    };
    /**
     * Override quota for the specified origin
     * @response `Storage.overrideQuotaForOrigin`
     */
    export type OverrideQuotaForOriginResponse = {};
    /**
     * Registers origin to be notified when an update occurs to its cache storage list.
     * @request `Storage.trackCacheStorageForOrigin`
     */
    export type TrackCacheStorageForOriginRequest = {
      /**
       * Security origin.
       */
      origin: string;
    };
    /**
     * Registers origin to be notified when an update occurs to its cache storage list.
     * @response `Storage.trackCacheStorageForOrigin`
     */
    export type TrackCacheStorageForOriginResponse = {};
    /**
     * Registers storage key to be notified when an update occurs to its cache storage list.
     * @request `Storage.trackCacheStorageForStorageKey`
     */
    export type TrackCacheStorageForStorageKeyRequest = {
      /**
       * Storage key.
       */
      storageKey: string;
    };
    /**
     * Registers storage key to be notified when an update occurs to its cache storage list.
     * @response `Storage.trackCacheStorageForStorageKey`
     */
    export type TrackCacheStorageForStorageKeyResponse = {};
    /**
     * Registers origin to be notified when an update occurs to its IndexedDB.
     * @request `Storage.trackIndexedDBForOrigin`
     */
    export type TrackIndexedDBForOriginRequest = {
      /**
       * Security origin.
       */
      origin: string;
    };
    /**
     * Registers origin to be notified when an update occurs to its IndexedDB.
     * @response `Storage.trackIndexedDBForOrigin`
     */
    export type TrackIndexedDBForOriginResponse = {};
    /**
     * Registers storage key to be notified when an update occurs to its IndexedDB.
     * @request `Storage.trackIndexedDBForStorageKey`
     */
    export type TrackIndexedDBForStorageKeyRequest = {
      /**
       * Storage key.
       */
      storageKey: string;
    };
    /**
     * Registers storage key to be notified when an update occurs to its IndexedDB.
     * @response `Storage.trackIndexedDBForStorageKey`
     */
    export type TrackIndexedDBForStorageKeyResponse = {};
    /**
     * Unregisters origin from receiving notifications for cache storage.
     * @request `Storage.untrackCacheStorageForOrigin`
     */
    export type UntrackCacheStorageForOriginRequest = {
      /**
       * Security origin.
       */
      origin: string;
    };
    /**
     * Unregisters origin from receiving notifications for cache storage.
     * @response `Storage.untrackCacheStorageForOrigin`
     */
    export type UntrackCacheStorageForOriginResponse = {};
    /**
     * Unregisters storage key from receiving notifications for cache storage.
     * @request `Storage.untrackCacheStorageForStorageKey`
     */
    export type UntrackCacheStorageForStorageKeyRequest = {
      /**
       * Storage key.
       */
      storageKey: string;
    };
    /**
     * Unregisters storage key from receiving notifications for cache storage.
     * @response `Storage.untrackCacheStorageForStorageKey`
     */
    export type UntrackCacheStorageForStorageKeyResponse = {};
    /**
     * Unregisters origin from receiving notifications for IndexedDB.
     * @request `Storage.untrackIndexedDBForOrigin`
     */
    export type UntrackIndexedDBForOriginRequest = {
      /**
       * Security origin.
       */
      origin: string;
    };
    /**
     * Unregisters origin from receiving notifications for IndexedDB.
     * @response `Storage.untrackIndexedDBForOrigin`
     */
    export type UntrackIndexedDBForOriginResponse = {};
    /**
     * Unregisters storage key from receiving notifications for IndexedDB.
     * @request `Storage.untrackIndexedDBForStorageKey`
     */
    export type UntrackIndexedDBForStorageKeyRequest = {
      /**
       * Storage key.
       */
      storageKey: string;
    };
    /**
     * Unregisters storage key from receiving notifications for IndexedDB.
     * @response `Storage.untrackIndexedDBForStorageKey`
     */
    export type UntrackIndexedDBForStorageKeyResponse = {};
    /**
     * Returns the number of stored Trust Tokens per issuer for the
     * current browsing context.
     * @request `Storage.getTrustTokens`
     */
    export type GetTrustTokensRequest = {};
    /**
     * Returns the number of stored Trust Tokens per issuer for the
     * current browsing context.
     * @response `Storage.getTrustTokens`
     */
    export type GetTrustTokensResponse = {
      tokens: TrustTokens[];
    };
    /**
     * Removes all Trust Tokens issued by the provided issuerOrigin.
     * Leaves other stored data, including the issuer's Redemption Records, intact.
     * @request `Storage.clearTrustTokens`
     */
    export type ClearTrustTokensRequest = {
      issuerOrigin: string;
    };
    /**
     * Removes all Trust Tokens issued by the provided issuerOrigin.
     * Leaves other stored data, including the issuer's Redemption Records, intact.
     * @response `Storage.clearTrustTokens`
     */
    export type ClearTrustTokensResponse = {
      /**
       * True if any tokens were deleted, false otherwise.
       */
      didDeleteTokens: boolean;
    };
    /**
     * Gets details for a named interest group.
     * @request `Storage.getInterestGroupDetails`
     */
    export type GetInterestGroupDetailsRequest = {
      ownerOrigin: string;
      name: string;
    };
    /**
     * Gets details for a named interest group.
     * @response `Storage.getInterestGroupDetails`
     */
    export type GetInterestGroupDetailsResponse = {
      details: InterestGroupDetails;
    };
    /**
     * Enables/Disables issuing of interestGroupAccessed events.
     * @request `Storage.setInterestGroupTracking`
     */
    export type SetInterestGroupTrackingRequest = {
      enable: boolean;
    };
    /**
     * Enables/Disables issuing of interestGroupAccessed events.
     * @response `Storage.setInterestGroupTracking`
     */
    export type SetInterestGroupTrackingResponse = {};
    /**
     * Gets metadata for an origin's shared storage.
     * @request `Storage.getSharedStorageMetadata`
     */
    export type GetSharedStorageMetadataRequest = {
      ownerOrigin: string;
    };
    /**
     * Gets metadata for an origin's shared storage.
     * @response `Storage.getSharedStorageMetadata`
     */
    export type GetSharedStorageMetadataResponse = {
      metadata: SharedStorageMetadata;
    };
    /**
     * Gets the entries in an given origin's shared storage.
     * @request `Storage.getSharedStorageEntries`
     */
    export type GetSharedStorageEntriesRequest = {
      ownerOrigin: string;
    };
    /**
     * Gets the entries in an given origin's shared storage.
     * @response `Storage.getSharedStorageEntries`
     */
    export type GetSharedStorageEntriesResponse = {
      entries: SharedStorageEntry[];
    };
    /**
     * Sets entry with `key` and `value` for a given origin's shared storage.
     * @request `Storage.setSharedStorageEntry`
     */
    export type SetSharedStorageEntryRequest = {
      ownerOrigin: string;
      key: string;
      value: string;
      /**
       * If `ignoreIfPresent` is included and true, then only sets the entry if
       * `key` doesn't already exist.
       */
      ignoreIfPresent?: boolean | undefined;
    };
    /**
     * Sets entry with `key` and `value` for a given origin's shared storage.
     * @response `Storage.setSharedStorageEntry`
     */
    export type SetSharedStorageEntryResponse = {};
    /**
     * Deletes entry for `key` (if it exists) for a given origin's shared storage.
     * @request `Storage.deleteSharedStorageEntry`
     */
    export type DeleteSharedStorageEntryRequest = {
      ownerOrigin: string;
      key: string;
    };
    /**
     * Deletes entry for `key` (if it exists) for a given origin's shared storage.
     * @response `Storage.deleteSharedStorageEntry`
     */
    export type DeleteSharedStorageEntryResponse = {};
    /**
     * Clears all entries for a given origin's shared storage.
     * @request `Storage.clearSharedStorageEntries`
     */
    export type ClearSharedStorageEntriesRequest = {
      ownerOrigin: string;
    };
    /**
     * Clears all entries for a given origin's shared storage.
     * @response `Storage.clearSharedStorageEntries`
     */
    export type ClearSharedStorageEntriesResponse = {};
    /**
     * Resets the budget for `ownerOrigin` by clearing all budget withdrawals.
     * @request `Storage.resetSharedStorageBudget`
     */
    export type ResetSharedStorageBudgetRequest = {
      ownerOrigin: string;
    };
    /**
     * Resets the budget for `ownerOrigin` by clearing all budget withdrawals.
     * @response `Storage.resetSharedStorageBudget`
     */
    export type ResetSharedStorageBudgetResponse = {};
    /**
     * Enables/disables issuing of sharedStorageAccessed events.
     * @request `Storage.setSharedStorageTracking`
     */
    export type SetSharedStorageTrackingRequest = {
      enable: boolean;
    };
    /**
     * Enables/disables issuing of sharedStorageAccessed events.
     * @response `Storage.setSharedStorageTracking`
     */
    export type SetSharedStorageTrackingResponse = {};
    /**
     * Set tracking for a storage key's buckets.
     * @request `Storage.setStorageBucketTracking`
     */
    export type SetStorageBucketTrackingRequest = {
      storageKey: string;
      enable: boolean;
    };
    /**
     * Set tracking for a storage key's buckets.
     * @response `Storage.setStorageBucketTracking`
     */
    export type SetStorageBucketTrackingResponse = {};
    /**
     * Deletes the Storage Bucket with the given storage key and bucket name.
     * @request `Storage.deleteStorageBucket`
     */
    export type DeleteStorageBucketRequest = {
      bucket: StorageBucket;
    };
    /**
     * Deletes the Storage Bucket with the given storage key and bucket name.
     * @response `Storage.deleteStorageBucket`
     */
    export type DeleteStorageBucketResponse = {};
    /**
     * Deletes state for sites identified as potential bounce trackers, immediately.
     * @request `Storage.runBounceTrackingMitigations`
     */
    export type RunBounceTrackingMitigationsRequest = {};
    /**
     * Deletes state for sites identified as potential bounce trackers, immediately.
     * @response `Storage.runBounceTrackingMitigations`
     */
    export type RunBounceTrackingMitigationsResponse = {
      deletedSites: string[];
    };
    /**
     * https://wicg.github.io/attribution-reporting-api/
     * @request `Storage.setAttributionReportingLocalTestingMode`
     */
    export type SetAttributionReportingLocalTestingModeRequest = {
      /**
       * If enabled, noise is suppressed and reports are sent immediately.
       */
      enabled: boolean;
    };
    /**
     * https://wicg.github.io/attribution-reporting-api/
     * @response `Storage.setAttributionReportingLocalTestingMode`
     */
    export type SetAttributionReportingLocalTestingModeResponse = {};
    /**
     * Enables/disables issuing of Attribution Reporting events.
     * @request `Storage.setAttributionReportingTracking`
     */
    export type SetAttributionReportingTrackingRequest = {
      enable: boolean;
    };
    /**
     * Enables/disables issuing of Attribution Reporting events.
     * @response `Storage.setAttributionReportingTracking`
     */
    export type SetAttributionReportingTrackingResponse = {};
  }
  export namespace SystemInfo {
    /**
     * Describes a single graphics processor (GPU).
     */
    export type GPUDevice = {
      /**
       * PCI ID of the GPU vendor, if available; 0 otherwise.
       */
      vendorId: number;
      /**
       * PCI ID of the GPU device, if available; 0 otherwise.
       */
      deviceId: number;
      /**
       * Sub sys ID of the GPU, only available on Windows.
       */
      subSysId?: number | undefined;
      /**
       * Revision of the GPU, only available on Windows.
       */
      revision?: number | undefined;
      /**
       * String description of the GPU vendor, if the PCI ID is not available.
       */
      vendorString: string;
      /**
       * String description of the GPU device, if the PCI ID is not available.
       */
      deviceString: string;
      /**
       * String description of the GPU driver vendor.
       */
      driverVendor: string;
      /**
       * String description of the GPU driver version.
       */
      driverVersion: string;
    };
    /**
     * Describes the width and height dimensions of an entity.
     */
    export type Size = {
      /**
       * Width in pixels.
       */
      width: number;
      /**
       * Height in pixels.
       */
      height: number;
    };
    /**
     * Describes a supported video decoding profile with its associated minimum and
     * maximum resolutions.
     */
    export type VideoDecodeAcceleratorCapability = {
      /**
       * Video codec profile that is supported, e.g. VP9 Profile 2.
       */
      profile: string;
      /**
       * Maximum video dimensions in pixels supported for this |profile|.
       */
      maxResolution: Size;
      /**
       * Minimum video dimensions in pixels supported for this |profile|.
       */
      minResolution: Size;
    };
    /**
     * Describes a supported video encoding profile with its associated maximum
     * resolution and maximum framerate.
     */
    export type VideoEncodeAcceleratorCapability = {
      /**
       * Video codec profile that is supported, e.g H264 Main.
       */
      profile: string;
      /**
       * Maximum video dimensions in pixels supported for this |profile|.
       */
      maxResolution: Size;
      /**
       * Maximum encoding framerate in frames per second supported for this
       * |profile|, as fraction's numerator and denominator, e.g. 24/1 fps,
       * 24000/1001 fps, etc.
       */
      maxFramerateNumerator: number;
      maxFramerateDenominator: number;
    };
    /**
     * YUV subsampling type of the pixels of a given image.
     */
    export type SubsamplingFormat = "yuv420" | "yuv422" | "yuv444";
    /**
     * Image format of a given image.
     */
    export type ImageType = "jpeg" | "webp" | "unknown";
    /**
     * Describes a supported image decoding profile with its associated minimum and
     * maximum resolutions and subsampling.
     */
    export type ImageDecodeAcceleratorCapability = {
      /**
       * Image coded, e.g. Jpeg.
       */
      imageType: ImageType;
      /**
       * Maximum supported dimensions of the image in pixels.
       */
      maxDimensions: Size;
      /**
       * Minimum supported dimensions of the image in pixels.
       */
      minDimensions: Size;
      /**
       * Optional array of supported subsampling formats, e.g. 4:2:0, if known.
       */
      subsamplings: SubsamplingFormat[];
    };
    /**
     * Provides information about the GPU(s) on the system.
     */
    export type GPUInfo = {
      /**
       * The graphics devices on the system. Element 0 is the primary GPU.
       */
      devices: GPUDevice[];
      /**
       * An optional dictionary of additional GPU related attributes.
       */
      auxAttributes?: Record<string, unknown> | undefined;
      /**
       * An optional dictionary of graphics features and their status.
       */
      featureStatus?: Record<string, unknown> | undefined;
      /**
       * An optional array of GPU driver bug workarounds.
       */
      driverBugWorkarounds: string[];
      /**
       * Supported accelerated video decoding capabilities.
       */
      videoDecoding: VideoDecodeAcceleratorCapability[];
      /**
       * Supported accelerated video encoding capabilities.
       */
      videoEncoding: VideoEncodeAcceleratorCapability[];
      /**
       * Supported accelerated image decoding capabilities.
       */
      imageDecoding: ImageDecodeAcceleratorCapability[];
    };
    /**
     * Represents process info.
     */
    export type ProcessInfo = {
      /**
       * Specifies process type.
       */
      type: string;
      /**
       * Specifies process id.
       */
      id: number;
      /**
       * Specifies cumulative CPU usage in seconds across all threads of the
       * process since the process start.
       */
      cpuTime: number;
    };
    /**
     * Returns information about the system.
     * @request `SystemInfo.getInfo`
     */
    export type GetInfoRequest = {};
    /**
     * Returns information about the system.
     * @response `SystemInfo.getInfo`
     */
    export type GetInfoResponse = {
      /**
       * Information about the GPUs on the system.
       */
      gpu: GPUInfo;
      /**
       * A platform-dependent description of the model of the machine. On Mac OS, this is, for
       * example, 'MacBookPro'. Will be the empty string if not supported.
       */
      modelName: string;
      /**
       * A platform-dependent description of the version of the machine. On Mac OS, this is, for
       * example, '10.1'. Will be the empty string if not supported.
       */
      modelVersion: string;
      /**
       * The command line string used to launch the browser. Will be the empty string if not
       * supported.
       */
      commandLine: string;
    };
    /**
     * Returns information about the feature state.
     * @request `SystemInfo.getFeatureState`
     */
    export type GetFeatureStateRequest = {
      featureState: string;
    };
    /**
     * Returns information about the feature state.
     * @response `SystemInfo.getFeatureState`
     */
    export type GetFeatureStateResponse = {
      featureEnabled: boolean;
    };
    /**
     * Returns information about all running processes.
     * @request `SystemInfo.getProcessInfo`
     */
    export type GetProcessInfoRequest = {};
    /**
     * Returns information about all running processes.
     * @response `SystemInfo.getProcessInfo`
     */
    export type GetProcessInfoResponse = {
      /**
       * An array of process info blocks.
       */
      processInfo: ProcessInfo[];
    };
  }
  export namespace Target {
    export type TargetID = string;
    /**
     * Unique identifier of attached debugging session.
     */
    export type SessionID = string;
    export type TargetInfo = {
      targetId: TargetID;
      type: string;
      title: string;
      url: string;
      /**
       * Whether the target has an attached client.
       */
      attached: boolean;
      /**
       * Opener target Id
       */
      openerId?: TargetID | undefined;
      /**
       * Whether the target has access to the originating window.
       */
      canAccessOpener: boolean;
      /**
       * Frame id of originating window (is only set if target has an opener).
       */
      openerFrameId?: Page.FrameId | undefined;
      browserContextId?: Browser.BrowserContextID | undefined;
      /**
       * Provides additional details for specific target types. For example, for
       * the type of "page", this may be set to "portal" or "prerender".
       */
      subtype?: string | undefined;
    };
    /**
     * A filter used by target query/discovery/auto-attach operations.
     */
    export type FilterEntry = {
      /**
       * If set, causes exclusion of mathcing targets from the list.
       */
      exclude?: boolean | undefined;
      /**
       * If not present, matches any type.
       */
      type?: string | undefined;
    };
    /**
     * The entries in TargetFilter are matched sequentially against targets and
     * the first entry that matches determines if the target is included or not,
     * depending on the value of `exclude` field in the entry.
     * If filter is not specified, the one assumed is
     * [{type: "browser", exclude: true}, {type: "tab", exclude: true}, {}]
     * (i.e. include everything but `browser` and `tab`).
     */
    export type TargetFilter = FilterEntry[];
    export type RemoteLocation = {
      host: string;
      port: number;
    };
    /**
     * Issued when attached to target because of auto-attach or `attachToTarget` command.
     * @event `Target.attachedToTarget`
     */
    export type AttachedToTargetEvent = {
      /**
       * Identifier assigned to the session used to send/receive messages.
       */
      sessionId: SessionID;
      targetInfo: TargetInfo;
      waitingForDebugger: boolean;
    };
    /**
     * Issued when detached from target for any reason (including `detachFromTarget` command). Can be
     * issued multiple times per target if multiple sessions have been attached to it.
     * @event `Target.detachedFromTarget`
     */
    export type DetachedFromTargetEvent = {
      /**
       * Detached session identifier.
       */
      sessionId: SessionID;
      /**
       * Deprecated.
       */
      targetId?: TargetID | undefined;
    };
    /**
     * Notifies about a new protocol message received from the session (as reported in
     * `attachedToTarget` event).
     * @event `Target.receivedMessageFromTarget`
     */
    export type ReceivedMessageFromTargetEvent = {
      /**
       * Identifier of a session which sends a message.
       */
      sessionId: SessionID;
      message: string;
      /**
       * Deprecated.
       */
      targetId?: TargetID | undefined;
    };
    /**
     * Issued when a possible inspection target is created.
     * @event `Target.targetCreated`
     */
    export type TargetCreatedEvent = {
      targetInfo: TargetInfo;
    };
    /**
     * Issued when a target is destroyed.
     * @event `Target.targetDestroyed`
     */
    export type TargetDestroyedEvent = {
      targetId: TargetID;
    };
    /**
     * Issued when a target has crashed.
     * @event `Target.targetCrashed`
     */
    export type TargetCrashedEvent = {
      targetId: TargetID;
      /**
       * Termination status type.
       */
      status: string;
      /**
       * Termination error code.
       */
      errorCode: number;
    };
    /**
     * Issued when some information about a target has changed. This only happens between
     * `targetCreated` and `targetDestroyed`.
     * @event `Target.targetInfoChanged`
     */
    export type TargetInfoChangedEvent = {
      targetInfo: TargetInfo;
    };
    /**
     * Activates (focuses) the target.
     * @request `Target.activateTarget`
     */
    export type ActivateTargetRequest = {
      targetId: TargetID;
    };
    /**
     * Activates (focuses) the target.
     * @response `Target.activateTarget`
     */
    export type ActivateTargetResponse = {};
    /**
     * Attaches to the target with given id.
     * @request `Target.attachToTarget`
     */
    export type AttachToTargetRequest = {
      targetId: TargetID;
      /**
       * Enables "flat" access to the session via specifying sessionId attribute in the commands.
       * We plan to make this the default, deprecate non-flattened mode,
       * and eventually retire it. See crbug.com/991325.
       */
      flatten?: boolean | undefined;
    };
    /**
     * Attaches to the target with given id.
     * @response `Target.attachToTarget`
     */
    export type AttachToTargetResponse = {
      /**
       * Id assigned to the session.
       */
      sessionId: SessionID;
    };
    /**
     * Attaches to the browser target, only uses flat sessionId mode.
     * @request `Target.attachToBrowserTarget`
     */
    export type AttachToBrowserTargetRequest = {};
    /**
     * Attaches to the browser target, only uses flat sessionId mode.
     * @response `Target.attachToBrowserTarget`
     */
    export type AttachToBrowserTargetResponse = {
      /**
       * Id assigned to the session.
       */
      sessionId: SessionID;
    };
    /**
     * Closes the target. If the target is a page that gets closed too.
     * @request `Target.closeTarget`
     */
    export type CloseTargetRequest = {
      targetId: TargetID;
    };
    /**
     * Closes the target. If the target is a page that gets closed too.
     * @response `Target.closeTarget`
     */
    export type CloseTargetResponse = {
      /**
       * Always set to true. If an error occurs, the response indicates protocol error.
       */
      success: boolean;
    };
    /**
     * Inject object to the target's main frame that provides a communication
     * channel with browser target.
     *
     * Injected object will be available as `window[bindingName]`.
     *
     * The object has the follwing API:
     * - `binding.send(json)` - a method to send messages over the remote debugging protocol
     * - `binding.onmessage = json => handleMessage(json)` - a callback that will be called for the protocol notifications and command responses.
     * @request `Target.exposeDevToolsProtocol`
     */
    export type ExposeDevToolsProtocolRequest = {
      targetId: TargetID;
      /**
       * Binding name, 'cdp' if not specified.
       */
      bindingName?: string | undefined;
    };
    /**
     * Inject object to the target's main frame that provides a communication
     * channel with browser target.
     *
     * Injected object will be available as `window[bindingName]`.
     *
     * The object has the follwing API:
     * - `binding.send(json)` - a method to send messages over the remote debugging protocol
     * - `binding.onmessage = json => handleMessage(json)` - a callback that will be called for the protocol notifications and command responses.
     * @response `Target.exposeDevToolsProtocol`
     */
    export type ExposeDevToolsProtocolResponse = {};
    /**
     * Creates a new empty BrowserContext. Similar to an incognito profile but you can have more than
     * one.
     * @request `Target.createBrowserContext`
     */
    export type CreateBrowserContextRequest = {
      /**
       * If specified, disposes this context when debugging session disconnects.
       */
      disposeOnDetach?: boolean | undefined;
      /**
       * Proxy server, similar to the one passed to --proxy-server
       */
      proxyServer?: string | undefined;
      /**
       * Proxy bypass list, similar to the one passed to --proxy-bypass-list
       */
      proxyBypassList?: string | undefined;
      /**
       * An optional list of origins to grant unlimited cross-origin access to.
       * Parts of the URL other than those constituting origin are ignored.
       */
      originsWithUniversalNetworkAccess?: string[] | undefined;
    };
    /**
     * Creates a new empty BrowserContext. Similar to an incognito profile but you can have more than
     * one.
     * @response `Target.createBrowserContext`
     */
    export type CreateBrowserContextResponse = {
      /**
       * The id of the context created.
       */
      browserContextId: Browser.BrowserContextID;
    };
    /**
     * Returns all browser contexts created with `Target.createBrowserContext` method.
     * @request `Target.getBrowserContexts`
     */
    export type GetBrowserContextsRequest = {};
    /**
     * Returns all browser contexts created with `Target.createBrowserContext` method.
     * @response `Target.getBrowserContexts`
     */
    export type GetBrowserContextsResponse = {
      /**
       * An array of browser context ids.
       */
      browserContextIds: Browser.BrowserContextID[];
    };
    /**
     * Creates a new page.
     * @request `Target.createTarget`
     */
    export type CreateTargetRequest = {
      /**
       * The initial URL the page will be navigated to. An empty string indicates about:blank.
       */
      url: string;
      /**
       * Frame width in DIP (headless chrome only).
       */
      width?: number | undefined;
      /**
       * Frame height in DIP (headless chrome only).
       */
      height?: number | undefined;
      /**
       * The browser context to create the page in.
       */
      browserContextId?: Browser.BrowserContextID | undefined;
      /**
       * Whether BeginFrames for this target will be controlled via DevTools (headless chrome only,
       * not supported on MacOS yet, false by default).
       */
      enableBeginFrameControl?: boolean | undefined;
      /**
       * Whether to create a new Window or Tab (chrome-only, false by default).
       */
      newWindow?: boolean | undefined;
      /**
       * Whether to create the target in background or foreground (chrome-only,
       * false by default).
       */
      background?: boolean | undefined;
      /**
       * Whether to create the target of type "tab".
       */
      forTab?: boolean | undefined;
    };
    /**
     * Creates a new page.
     * @response `Target.createTarget`
     */
    export type CreateTargetResponse = {
      /**
       * The id of the page opened.
       */
      targetId: TargetID;
    };
    /**
     * Detaches session with given id.
     * @request `Target.detachFromTarget`
     */
    export type DetachFromTargetRequest = {
      /**
       * Session to detach.
       */
      sessionId?: SessionID | undefined;
      /**
       * Deprecated.
       */
      targetId?: TargetID | undefined;
    };
    /**
     * Detaches session with given id.
     * @response `Target.detachFromTarget`
     */
    export type DetachFromTargetResponse = {};
    /**
     * Deletes a BrowserContext. All the belonging pages will be closed without calling their
     * beforeunload hooks.
     * @request `Target.disposeBrowserContext`
     */
    export type DisposeBrowserContextRequest = {
      browserContextId: Browser.BrowserContextID;
    };
    /**
     * Deletes a BrowserContext. All the belonging pages will be closed without calling their
     * beforeunload hooks.
     * @response `Target.disposeBrowserContext`
     */
    export type DisposeBrowserContextResponse = {};
    /**
     * Returns information about a target.
     * @request `Target.getTargetInfo`
     */
    export type GetTargetInfoRequest = {
      targetId?: TargetID | undefined;
    };
    /**
     * Returns information about a target.
     * @response `Target.getTargetInfo`
     */
    export type GetTargetInfoResponse = {
      targetInfo: TargetInfo;
    };
    /**
     * Retrieves a list of available targets.
     * @request `Target.getTargets`
     */
    export type GetTargetsRequest = {
      /**
       * Only targets matching filter will be reported. If filter is not specified
       * and target discovery is currently enabled, a filter used for target discovery
       * is used for consistency.
       */
      filter?: TargetFilter | undefined;
    };
    /**
     * Retrieves a list of available targets.
     * @response `Target.getTargets`
     */
    export type GetTargetsResponse = {
      /**
       * The list of targets.
       */
      targetInfos: TargetInfo[];
    };
    /**
     * Sends protocol message over session with given id.
     * Consider using flat mode instead; see commands attachToTarget, setAutoAttach,
     * and crbug.com/991325.
     * @request `Target.sendMessageToTarget`
     */
    export type SendMessageToTargetRequest = {
      message: string;
      /**
       * Identifier of the session.
       */
      sessionId?: SessionID | undefined;
      /**
       * Deprecated.
       */
      targetId?: TargetID | undefined;
    };
    /**
     * Sends protocol message over session with given id.
     * Consider using flat mode instead; see commands attachToTarget, setAutoAttach,
     * and crbug.com/991325.
     * @response `Target.sendMessageToTarget`
     */
    export type SendMessageToTargetResponse = {};
    /**
     * Controls whether to automatically attach to new targets which are considered to be related to
     * this one. When turned on, attaches to all existing related targets as well. When turned off,
     * automatically detaches from all currently attached targets.
     * This also clears all targets added by `autoAttachRelated` from the list of targets to watch
     * for creation of related targets.
     * @request `Target.setAutoAttach`
     */
    export type SetAutoAttachRequest = {
      /**
       * Whether to auto-attach to related targets.
       */
      autoAttach: boolean;
      /**
       * Whether to pause new targets when attaching to them. Use `Runtime.runIfWaitingForDebugger`
       * to run paused targets.
       */
      waitForDebuggerOnStart: boolean;
      /**
       * Enables "flat" access to the session via specifying sessionId attribute in the commands.
       * We plan to make this the default, deprecate non-flattened mode,
       * and eventually retire it. See crbug.com/991325.
       */
      flatten?: boolean | undefined;
      /**
       * Only targets matching filter will be attached.
       */
      filter?: TargetFilter | undefined;
    };
    /**
     * Controls whether to automatically attach to new targets which are considered to be related to
     * this one. When turned on, attaches to all existing related targets as well. When turned off,
     * automatically detaches from all currently attached targets.
     * This also clears all targets added by `autoAttachRelated` from the list of targets to watch
     * for creation of related targets.
     * @response `Target.setAutoAttach`
     */
    export type SetAutoAttachResponse = {};
    /**
     * Adds the specified target to the list of targets that will be monitored for any related target
     * creation (such as child frames, child workers and new versions of service worker) and reported
     * through `attachedToTarget`. The specified target is also auto-attached.
     * This cancels the effect of any previous `setAutoAttach` and is also cancelled by subsequent
     * `setAutoAttach`. Only available at the Browser target.
     * @request `Target.autoAttachRelated`
     */
    export type AutoAttachRelatedRequest = {
      targetId: TargetID;
      /**
       * Whether to pause new targets when attaching to them. Use `Runtime.runIfWaitingForDebugger`
       * to run paused targets.
       */
      waitForDebuggerOnStart: boolean;
      /**
       * Only targets matching filter will be attached.
       */
      filter?: TargetFilter | undefined;
    };
    /**
     * Adds the specified target to the list of targets that will be monitored for any related target
     * creation (such as child frames, child workers and new versions of service worker) and reported
     * through `attachedToTarget`. The specified target is also auto-attached.
     * This cancels the effect of any previous `setAutoAttach` and is also cancelled by subsequent
     * `setAutoAttach`. Only available at the Browser target.
     * @response `Target.autoAttachRelated`
     */
    export type AutoAttachRelatedResponse = {};
    /**
     * Controls whether to discover available targets and notify via
     * `targetCreated/targetInfoChanged/targetDestroyed` events.
     * @request `Target.setDiscoverTargets`
     */
    export type SetDiscoverTargetsRequest = {
      /**
       * Whether to discover available targets.
       */
      discover: boolean;
      /**
       * Only targets matching filter will be attached. If `discover` is false,
       * `filter` must be omitted or empty.
       */
      filter?: TargetFilter | undefined;
    };
    /**
     * Controls whether to discover available targets and notify via
     * `targetCreated/targetInfoChanged/targetDestroyed` events.
     * @response `Target.setDiscoverTargets`
     */
    export type SetDiscoverTargetsResponse = {};
    /**
     * Enables target discovery for the specified locations, when `setDiscoverTargets` was set to
     * `true`.
     * @request `Target.setRemoteLocations`
     */
    export type SetRemoteLocationsRequest = {
      /**
       * List of remote locations.
       */
      locations: RemoteLocation[];
    };
    /**
     * Enables target discovery for the specified locations, when `setDiscoverTargets` was set to
     * `true`.
     * @response `Target.setRemoteLocations`
     */
    export type SetRemoteLocationsResponse = {};
  }
  export namespace Tethering {
    /**
     * Informs that port was successfully bound and got a specified connection id.
     * @event `Tethering.accepted`
     */
    export type AcceptedEvent = {
      /**
       * Port number that was successfully bound.
       */
      port: number;
      /**
       * Connection id to be used.
       */
      connectionId: string;
    };
    /**
     * Request browser port binding.
     * @request `Tethering.bind`
     */
    export type BindRequest = {
      /**
       * Port number to bind.
       */
      port: number;
    };
    /**
     * Request browser port binding.
     * @response `Tethering.bind`
     */
    export type BindResponse = {};
    /**
     * Request browser port unbinding.
     * @request `Tethering.unbind`
     */
    export type UnbindRequest = {
      /**
       * Port number to unbind.
       */
      port: number;
    };
    /**
     * Request browser port unbinding.
     * @response `Tethering.unbind`
     */
    export type UnbindResponse = {};
  }
  export namespace Tracing {
    /**
     * Configuration for memory dump. Used only when "memory-infra" category is enabled.
     */
    export type MemoryDumpConfig = Record<string, unknown>;
    export type TraceConfig = {
      /**
       * Controls how the trace buffer stores data.
       */
      recordMode?: "recordUntilFull" | "recordContinuously" | "recordAsMuchAsPossible" | "echoToConsole" | undefined;
      /**
       * Size of the trace buffer in kilobytes. If not specified or zero is passed, a default value
       * of 200 MB would be used.
       */
      traceBufferSizeInKb?: number | undefined;
      /**
       * Turns on JavaScript stack sampling.
       */
      enableSampling?: boolean | undefined;
      /**
       * Turns on system tracing.
       */
      enableSystrace?: boolean | undefined;
      /**
       * Turns on argument filter.
       */
      enableArgumentFilter?: boolean | undefined;
      /**
       * Included category filters.
       */
      includedCategories?: string[] | undefined;
      /**
       * Excluded category filters.
       */
      excludedCategories?: string[] | undefined;
      /**
       * Configuration to synthesize the delays in tracing.
       */
      syntheticDelays?: string[] | undefined;
      /**
       * Configuration for memory dump triggers. Used only when "memory-infra" category is enabled.
       */
      memoryDumpConfig?: MemoryDumpConfig | undefined;
    };
    /**
     * Data format of a trace. Can be either the legacy JSON format or the
     * protocol buffer format. Note that the JSON format will be deprecated soon.
     */
    export type StreamFormat = "json" | "proto";
    /**
     * Compression type to use for traces returned via streams.
     */
    export type StreamCompression = "none" | "gzip";
    /**
     * Details exposed when memory request explicitly declared.
     * Keep consistent with memory_dump_request_args.h and
     * memory_instrumentation.mojom
     */
    export type MemoryDumpLevelOfDetail = "background" | "light" | "detailed";
    /**
     * Backend type to use for tracing. `chrome` uses the Chrome-integrated
     * tracing service and is supported on all platforms. `system` is only
     * supported on Chrome OS and uses the Perfetto system tracing service.
     * `auto` chooses `system` when the perfettoConfig provided to Tracing.start
     * specifies at least one non-Chrome data source; otherwise uses `chrome`.
     */
    export type TracingBackend = "auto" | "chrome" | "system";
    /**
     * undefined
     * @event `Tracing.bufferUsage`
     */
    export type BufferUsageEvent = {
      /**
       * A number in range [0..1] that indicates the used size of event buffer as a fraction of its
       * total size.
       */
      percentFull?: number | undefined;
      /**
       * An approximate number of events in the trace log.
       */
      eventCount?: number | undefined;
      /**
       * A number in range [0..1] that indicates the used size of event buffer as a fraction of its
       * total size.
       */
      value?: number | undefined;
    };
    /**
     * Contains a bucket of collected trace events. When tracing is stopped collected events will be
     * sent as a sequence of dataCollected events followed by tracingComplete event.
     * @event `Tracing.dataCollected`
     */
    export type DataCollectedEvent = {
      value: Record<string, unknown>[];
    };
    /**
     * Signals that tracing is stopped and there is no trace buffers pending flush, all data were
     * delivered via dataCollected events.
     * @event `Tracing.tracingComplete`
     */
    export type TracingCompleteEvent = {
      /**
       * Indicates whether some trace data is known to have been lost, e.g. because the trace ring
       * buffer wrapped around.
       */
      dataLossOccurred: boolean;
      /**
       * A handle of the stream that holds resulting trace data.
       */
      stream?: IO.StreamHandle | undefined;
      /**
       * Trace data format of returned stream.
       */
      traceFormat?: StreamFormat | undefined;
      /**
       * Compression format of returned stream.
       */
      streamCompression?: StreamCompression | undefined;
    };
    /**
     * Stop trace events collection.
     * @request `Tracing.end`
     */
    export type EndRequest = {};
    /**
     * Stop trace events collection.
     * @response `Tracing.end`
     */
    export type EndResponse = {};
    /**
     * Gets supported tracing categories.
     * @request `Tracing.getCategories`
     */
    export type GetCategoriesRequest = {};
    /**
     * Gets supported tracing categories.
     * @response `Tracing.getCategories`
     */
    export type GetCategoriesResponse = {
      /**
       * A list of supported tracing categories.
       */
      categories: string[];
    };
    /**
     * Record a clock sync marker in the trace.
     * @request `Tracing.recordClockSyncMarker`
     */
    export type RecordClockSyncMarkerRequest = {
      /**
       * The ID of this clock sync marker
       */
      syncId: string;
    };
    /**
     * Record a clock sync marker in the trace.
     * @response `Tracing.recordClockSyncMarker`
     */
    export type RecordClockSyncMarkerResponse = {};
    /**
     * Request a global memory dump.
     * @request `Tracing.requestMemoryDump`
     */
    export type RequestMemoryDumpRequest = {
      /**
       * Enables more deterministic results by forcing garbage collection
       */
      deterministic?: boolean | undefined;
      /**
       * Specifies level of details in memory dump. Defaults to "detailed".
       */
      levelOfDetail?: MemoryDumpLevelOfDetail | undefined;
    };
    /**
     * Request a global memory dump.
     * @response `Tracing.requestMemoryDump`
     */
    export type RequestMemoryDumpResponse = {
      /**
       * GUID of the resulting global memory dump.
       */
      dumpGuid: string;
      /**
       * True iff the global memory dump succeeded.
       */
      success: boolean;
    };
    /**
     * Start trace events collection.
     * @request `Tracing.start`
     */
    export type StartRequest = {
      /**
       * Category/tag filter
       */
      categories?: string | undefined;
      /**
       * Tracing options
       */
      options?: string | undefined;
      /**
       * If set, the agent will issue bufferUsage events at this interval, specified in milliseconds
       */
      bufferUsageReportingInterval?: number | undefined;
      /**
       * Whether to report trace events as series of dataCollected events or to save trace to a
       * stream (defaults to `ReportEvents`).
       */
      transferMode?: "ReportEvents" | "ReturnAsStream" | undefined;
      /**
       * Trace data format to use. This only applies when using `ReturnAsStream`
       * transfer mode (defaults to `json`).
       */
      streamFormat?: StreamFormat | undefined;
      /**
       * Compression format to use. This only applies when using `ReturnAsStream`
       * transfer mode (defaults to `none`)
       */
      streamCompression?: StreamCompression | undefined;
      traceConfig?: TraceConfig | undefined;
      /**
       * Base64-encoded serialized perfetto.protos.TraceConfig protobuf message
       * When specified, the parameters `categories`, `options`, `traceConfig`
       * are ignored. (Encoded as a base64 string when passed over JSON)
       */
      perfettoConfig?: string | undefined;
      /**
       * Backend type (defaults to `auto`)
       */
      tracingBackend?: TracingBackend | undefined;
    };
    /**
     * Start trace events collection.
     * @response `Tracing.start`
     */
    export type StartResponse = {};
  }
  export namespace WebAudio {
    /**
     * An unique ID for a graph object (AudioContext, AudioNode, AudioParam) in Web Audio API
     */
    export type GraphObjectId = string;
    /**
     * Enum of BaseAudioContext types
     */
    export type ContextType = "realtime" | "offline";
    /**
     * Enum of AudioContextState from the spec
     */
    export type ContextState = "suspended" | "running" | "closed";
    /**
     * Enum of AudioNode types
     */
    export type NodeType = string;
    /**
     * Enum of AudioNode::ChannelCountMode from the spec
     */
    export type ChannelCountMode = "clamped-max" | "explicit" | "max";
    /**
     * Enum of AudioNode::ChannelInterpretation from the spec
     */
    export type ChannelInterpretation = "discrete" | "speakers";
    /**
     * Enum of AudioParam types
     */
    export type ParamType = string;
    /**
     * Enum of AudioParam::AutomationRate from the spec
     */
    export type AutomationRate = "a-rate" | "k-rate";
    /**
     * Fields in AudioContext that change in real-time.
     */
    export type ContextRealtimeData = {
      /**
       * The current context time in second in BaseAudioContext.
       */
      currentTime: number;
      /**
       * The time spent on rendering graph divided by render quantum duration,
       * and multiplied by 100. 100 means the audio renderer reached the full
       * capacity and glitch may occur.
       */
      renderCapacity: number;
      /**
       * A running mean of callback interval.
       */
      callbackIntervalMean: number;
      /**
       * A running variance of callback interval.
       */
      callbackIntervalVariance: number;
    };
    /**
     * Protocol object for BaseAudioContext
     */
    export type BaseAudioContext = {
      contextId: GraphObjectId;
      contextType: ContextType;
      contextState: ContextState;
      realtimeData?: ContextRealtimeData | undefined;
      /**
       * Platform-dependent callback buffer size.
       */
      callbackBufferSize: number;
      /**
       * Number of output channels supported by audio hardware in use.
       */
      maxOutputChannelCount: number;
      /**
       * Context sample rate.
       */
      sampleRate: number;
    };
    /**
     * Protocol object for AudioListener
     */
    export type AudioListener = {
      listenerId: GraphObjectId;
      contextId: GraphObjectId;
    };
    /**
     * Protocol object for AudioNode
     */
    export type AudioNode = {
      nodeId: GraphObjectId;
      contextId: GraphObjectId;
      nodeType: NodeType;
      numberOfInputs: number;
      numberOfOutputs: number;
      channelCount: number;
      channelCountMode: ChannelCountMode;
      channelInterpretation: ChannelInterpretation;
    };
    /**
     * Protocol object for AudioParam
     */
    export type AudioParam = {
      paramId: GraphObjectId;
      nodeId: GraphObjectId;
      contextId: GraphObjectId;
      paramType: ParamType;
      rate: AutomationRate;
      defaultValue: number;
      minValue: number;
      maxValue: number;
    };
    /**
     * Notifies that a new BaseAudioContext has been created.
     * @event `WebAudio.contextCreated`
     */
    export type ContextCreatedEvent = {
      context: BaseAudioContext;
    };
    /**
     * Notifies that an existing BaseAudioContext will be destroyed.
     * @event `WebAudio.contextWillBeDestroyed`
     */
    export type ContextWillBeDestroyedEvent = {
      contextId: GraphObjectId;
    };
    /**
     * Notifies that existing BaseAudioContext has changed some properties (id stays the same)..
     * @event `WebAudio.contextChanged`
     */
    export type ContextChangedEvent = {
      context: BaseAudioContext;
    };
    /**
     * Notifies that the construction of an AudioListener has finished.
     * @event `WebAudio.audioListenerCreated`
     */
    export type AudioListenerCreatedEvent = {
      listener: AudioListener;
    };
    /**
     * Notifies that a new AudioListener has been created.
     * @event `WebAudio.audioListenerWillBeDestroyed`
     */
    export type AudioListenerWillBeDestroyedEvent = {
      contextId: GraphObjectId;
      listenerId: GraphObjectId;
    };
    /**
     * Notifies that a new AudioNode has been created.
     * @event `WebAudio.audioNodeCreated`
     */
    export type AudioNodeCreatedEvent = {
      node: AudioNode;
    };
    /**
     * Notifies that an existing AudioNode has been destroyed.
     * @event `WebAudio.audioNodeWillBeDestroyed`
     */
    export type AudioNodeWillBeDestroyedEvent = {
      contextId: GraphObjectId;
      nodeId: GraphObjectId;
    };
    /**
     * Notifies that a new AudioParam has been created.
     * @event `WebAudio.audioParamCreated`
     */
    export type AudioParamCreatedEvent = {
      param: AudioParam;
    };
    /**
     * Notifies that an existing AudioParam has been destroyed.
     * @event `WebAudio.audioParamWillBeDestroyed`
     */
    export type AudioParamWillBeDestroyedEvent = {
      contextId: GraphObjectId;
      nodeId: GraphObjectId;
      paramId: GraphObjectId;
    };
    /**
     * Notifies that two AudioNodes are connected.
     * @event `WebAudio.nodesConnected`
     */
    export type NodesConnectedEvent = {
      contextId: GraphObjectId;
      sourceId: GraphObjectId;
      destinationId: GraphObjectId;
      sourceOutputIndex?: number | undefined;
      destinationInputIndex?: number | undefined;
    };
    /**
     * Notifies that AudioNodes are disconnected. The destination can be null, and it means all the outgoing connections from the source are disconnected.
     * @event `WebAudio.nodesDisconnected`
     */
    export type NodesDisconnectedEvent = {
      contextId: GraphObjectId;
      sourceId: GraphObjectId;
      destinationId: GraphObjectId;
      sourceOutputIndex?: number | undefined;
      destinationInputIndex?: number | undefined;
    };
    /**
     * Notifies that an AudioNode is connected to an AudioParam.
     * @event `WebAudio.nodeParamConnected`
     */
    export type NodeParamConnectedEvent = {
      contextId: GraphObjectId;
      sourceId: GraphObjectId;
      destinationId: GraphObjectId;
      sourceOutputIndex?: number | undefined;
    };
    /**
     * Notifies that an AudioNode is disconnected to an AudioParam.
     * @event `WebAudio.nodeParamDisconnected`
     */
    export type NodeParamDisconnectedEvent = {
      contextId: GraphObjectId;
      sourceId: GraphObjectId;
      destinationId: GraphObjectId;
      sourceOutputIndex?: number | undefined;
    };
    /**
     * Enables the WebAudio domain and starts sending context lifetime events.
     * @request `WebAudio.enable`
     */
    export type EnableRequest = {};
    /**
     * Enables the WebAudio domain and starts sending context lifetime events.
     * @response `WebAudio.enable`
     */
    export type EnableResponse = {};
    /**
     * Disables the WebAudio domain.
     * @request `WebAudio.disable`
     */
    export type DisableRequest = {};
    /**
     * Disables the WebAudio domain.
     * @response `WebAudio.disable`
     */
    export type DisableResponse = {};
    /**
     * Fetch the realtime data from the registered contexts.
     * @request `WebAudio.getRealtimeData`
     */
    export type GetRealtimeDataRequest = {
      contextId: GraphObjectId;
    };
    /**
     * Fetch the realtime data from the registered contexts.
     * @response `WebAudio.getRealtimeData`
     */
    export type GetRealtimeDataResponse = {
      realtimeData: ContextRealtimeData;
    };
  }
  export namespace WebAuthn {
    export type AuthenticatorId = string;
    export type AuthenticatorProtocol = "u2f" | "ctap2";
    export type Ctap2Version = "ctap2_0" | "ctap2_1";
    export type AuthenticatorTransport = "usb" | "nfc" | "ble" | "cable" | "internal";
    export type VirtualAuthenticatorOptions = {
      protocol: AuthenticatorProtocol;
      /**
       * Defaults to ctap2_0. Ignored if |protocol| == u2f.
       */
      ctap2Version?: Ctap2Version | undefined;
      transport: AuthenticatorTransport;
      /**
       * Defaults to false.
       */
      hasResidentKey?: boolean | undefined;
      /**
       * Defaults to false.
       */
      hasUserVerification?: boolean | undefined;
      /**
       * If set to true, the authenticator will support the largeBlob extension.
       * https://w3c.github.io/webauthn#largeBlob
       * Defaults to false.
       */
      hasLargeBlob?: boolean | undefined;
      /**
       * If set to true, the authenticator will support the credBlob extension.
       * https://fidoalliance.org/specs/fido-v2.1-rd-20201208/fido-client-to-authenticator-protocol-v2.1-rd-20201208.html#sctn-credBlob-extension
       * Defaults to false.
       */
      hasCredBlob?: boolean | undefined;
      /**
       * If set to true, the authenticator will support the minPinLength extension.
       * https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-20210615.html#sctn-minpinlength-extension
       * Defaults to false.
       */
      hasMinPinLength?: boolean | undefined;
      /**
       * If set to true, the authenticator will support the prf extension.
       * https://w3c.github.io/webauthn/#prf-extension
       * Defaults to false.
       */
      hasPrf?: boolean | undefined;
      /**
       * If set to true, tests of user presence will succeed immediately.
       * Otherwise, they will not be resolved. Defaults to true.
       */
      automaticPresenceSimulation?: boolean | undefined;
      /**
       * Sets whether User Verification succeeds or fails for an authenticator.
       * Defaults to false.
       */
      isUserVerified?: boolean | undefined;
      /**
       * Credentials created by this authenticator will have the backup
       * eligibility (BE) flag set to this value. Defaults to false.
       * https://w3c.github.io/webauthn/#sctn-credential-backup
       */
      defaultBackupEligibility?: boolean | undefined;
      /**
       * Credentials created by this authenticator will have the backup state
       * (BS) flag set to this value. Defaults to false.
       * https://w3c.github.io/webauthn/#sctn-credential-backup
       */
      defaultBackupState?: boolean | undefined;
    };
    export type Credential = {
      credentialId: string;
      isResidentCredential: boolean;
      /**
       * Relying Party ID the credential is scoped to. Must be set when adding a
       * credential.
       */
      rpId?: string | undefined;
      /**
       * The ECDSA P-256 private key in PKCS#8 format. (Encoded as a base64 string when passed over JSON)
       */
      privateKey: string;
      /**
       * An opaque byte sequence with a maximum size of 64 bytes mapping the
       * credential to a specific user. (Encoded as a base64 string when passed over JSON)
       */
      userHandle?: string | undefined;
      /**
       * Signature counter. This is incremented by one for each successful
       * assertion.
       * See https://w3c.github.io/webauthn/#signature-counter
       */
      signCount: number;
      /**
       * The large blob associated with the credential.
       * See https://w3c.github.io/webauthn/#sctn-large-blob-extension (Encoded as a base64 string when passed over JSON)
       */
      largeBlob?: string | undefined;
    };
    /**
     * Triggered when a credential is added to an authenticator.
     * @event `WebAuthn.credentialAdded`
     */
    export type CredentialAddedEvent = {
      authenticatorId: AuthenticatorId;
      credential: Credential;
    };
    /**
     * Triggered when a credential is used in a webauthn assertion.
     * @event `WebAuthn.credentialAsserted`
     */
    export type CredentialAssertedEvent = {
      authenticatorId: AuthenticatorId;
      credential: Credential;
    };
    /**
     * Enable the WebAuthn domain and start intercepting credential storage and
     * retrieval with a virtual authenticator.
     * @request `WebAuthn.enable`
     */
    export type EnableRequest = {
      /**
       * Whether to enable the WebAuthn user interface. Enabling the UI is
       * recommended for debugging and demo purposes, as it is closer to the real
       * experience. Disabling the UI is recommended for automated testing.
       * Supported at the embedder's discretion if UI is available.
       * Defaults to false.
       */
      enableUI?: boolean | undefined;
    };
    /**
     * Enable the WebAuthn domain and start intercepting credential storage and
     * retrieval with a virtual authenticator.
     * @response `WebAuthn.enable`
     */
    export type EnableResponse = {};
    /**
     * Disable the WebAuthn domain.
     * @request `WebAuthn.disable`
     */
    export type DisableRequest = {};
    /**
     * Disable the WebAuthn domain.
     * @response `WebAuthn.disable`
     */
    export type DisableResponse = {};
    /**
     * Creates and adds a virtual authenticator.
     * @request `WebAuthn.addVirtualAuthenticator`
     */
    export type AddVirtualAuthenticatorRequest = {
      options: VirtualAuthenticatorOptions;
    };
    /**
     * Creates and adds a virtual authenticator.
     * @response `WebAuthn.addVirtualAuthenticator`
     */
    export type AddVirtualAuthenticatorResponse = {
      authenticatorId: AuthenticatorId;
    };
    /**
     * Resets parameters isBogusSignature, isBadUV, isBadUP to false if they are not present.
     * @request `WebAuthn.setResponseOverrideBits`
     */
    export type SetResponseOverrideBitsRequest = {
      authenticatorId: AuthenticatorId;
      /**
       * If isBogusSignature is set, overrides the signature in the authenticator response to be zero.
       * Defaults to false.
       */
      isBogusSignature?: boolean | undefined;
      /**
       * If isBadUV is set, overrides the UV bit in the flags in the authenticator response to
       * be zero. Defaults to false.
       */
      isBadUV?: boolean | undefined;
      /**
       * If isBadUP is set, overrides the UP bit in the flags in the authenticator response to
       * be zero. Defaults to false.
       */
      isBadUP?: boolean | undefined;
    };
    /**
     * Resets parameters isBogusSignature, isBadUV, isBadUP to false if they are not present.
     * @response `WebAuthn.setResponseOverrideBits`
     */
    export type SetResponseOverrideBitsResponse = {};
    /**
     * Removes the given authenticator.
     * @request `WebAuthn.removeVirtualAuthenticator`
     */
    export type RemoveVirtualAuthenticatorRequest = {
      authenticatorId: AuthenticatorId;
    };
    /**
     * Removes the given authenticator.
     * @response `WebAuthn.removeVirtualAuthenticator`
     */
    export type RemoveVirtualAuthenticatorResponse = {};
    /**
     * Adds the credential to the specified authenticator.
     * @request `WebAuthn.addCredential`
     */
    export type AddCredentialRequest = {
      authenticatorId: AuthenticatorId;
      credential: Credential;
    };
    /**
     * Adds the credential to the specified authenticator.
     * @response `WebAuthn.addCredential`
     */
    export type AddCredentialResponse = {};
    /**
     * Returns a single credential stored in the given virtual authenticator that
     * matches the credential ID.
     * @request `WebAuthn.getCredential`
     */
    export type GetCredentialRequest = {
      authenticatorId: AuthenticatorId;
      credentialId: string;
    };
    /**
     * Returns a single credential stored in the given virtual authenticator that
     * matches the credential ID.
     * @response `WebAuthn.getCredential`
     */
    export type GetCredentialResponse = {
      credential: Credential;
    };
    /**
     * Returns all the credentials stored in the given virtual authenticator.
     * @request `WebAuthn.getCredentials`
     */
    export type GetCredentialsRequest = {
      authenticatorId: AuthenticatorId;
    };
    /**
     * Returns all the credentials stored in the given virtual authenticator.
     * @response `WebAuthn.getCredentials`
     */
    export type GetCredentialsResponse = {
      credentials: Credential[];
    };
    /**
     * Removes a credential from the authenticator.
     * @request `WebAuthn.removeCredential`
     */
    export type RemoveCredentialRequest = {
      authenticatorId: AuthenticatorId;
      credentialId: string;
    };
    /**
     * Removes a credential from the authenticator.
     * @response `WebAuthn.removeCredential`
     */
    export type RemoveCredentialResponse = {};
    /**
     * Clears all the credentials from the specified device.
     * @request `WebAuthn.clearCredentials`
     */
    export type ClearCredentialsRequest = {
      authenticatorId: AuthenticatorId;
    };
    /**
     * Clears all the credentials from the specified device.
     * @response `WebAuthn.clearCredentials`
     */
    export type ClearCredentialsResponse = {};
    /**
     * Sets whether User Verification succeeds or fails for an authenticator.
     * The default is true.
     * @request `WebAuthn.setUserVerified`
     */
    export type SetUserVerifiedRequest = {
      authenticatorId: AuthenticatorId;
      isUserVerified: boolean;
    };
    /**
     * Sets whether User Verification succeeds or fails for an authenticator.
     * The default is true.
     * @response `WebAuthn.setUserVerified`
     */
    export type SetUserVerifiedResponse = {};
    /**
     * Sets whether tests of user presence will succeed immediately (if true) or fail to resolve (if false) for an authenticator.
     * The default is true.
     * @request `WebAuthn.setAutomaticPresenceSimulation`
     */
    export type SetAutomaticPresenceSimulationRequest = {
      authenticatorId: AuthenticatorId;
      enabled: boolean;
    };
    /**
     * Sets whether tests of user presence will succeed immediately (if true) or fail to resolve (if false) for an authenticator.
     * The default is true.
     * @response `WebAuthn.setAutomaticPresenceSimulation`
     */
    export type SetAutomaticPresenceSimulationResponse = {};
  }
  export type EventMap = {
    "Accessibility.loadComplete": Accessibility.LoadCompleteEvent;
    "Accessibility.nodesUpdated": Accessibility.NodesUpdatedEvent;
    "Animation.animationCanceled": Animation.AnimationCanceledEvent;
    "Animation.animationCreated": Animation.AnimationCreatedEvent;
    "Animation.animationStarted": Animation.AnimationStartedEvent;
    "Audits.issueAdded": Audits.IssueAddedEvent;
    "Autofill.addressFormFilled": Autofill.AddressFormFilledEvent;
    "BackgroundService.recordingStateChanged": BackgroundService.RecordingStateChangedEvent;
    "BackgroundService.backgroundServiceEventReceived": BackgroundService.BackgroundServiceEventReceivedEvent;
    "Browser.downloadWillBegin": Browser.DownloadWillBeginEvent;
    "Browser.downloadProgress": Browser.DownloadProgressEvent;
    "Cast.sinksUpdated": Cast.SinksUpdatedEvent;
    "Cast.issueUpdated": Cast.IssueUpdatedEvent;
    "CSS.fontsUpdated": CSS.FontsUpdatedEvent;
    "CSS.mediaQueryResultChanged": CSS.MediaQueryResultChangedEvent;
    "CSS.styleSheetAdded": CSS.StyleSheetAddedEvent;
    "CSS.styleSheetChanged": CSS.StyleSheetChangedEvent;
    "CSS.styleSheetRemoved": CSS.StyleSheetRemovedEvent;
    "Database.addDatabase": Database.AddDatabaseEvent;
    "DeviceAccess.deviceRequestPrompted": DeviceAccess.DeviceRequestPromptedEvent;
    "DOM.attributeModified": DOM.AttributeModifiedEvent;
    "DOM.attributeRemoved": DOM.AttributeRemovedEvent;
    "DOM.characterDataModified": DOM.CharacterDataModifiedEvent;
    "DOM.childNodeCountUpdated": DOM.ChildNodeCountUpdatedEvent;
    "DOM.childNodeInserted": DOM.ChildNodeInsertedEvent;
    "DOM.childNodeRemoved": DOM.ChildNodeRemovedEvent;
    "DOM.distributedNodesUpdated": DOM.DistributedNodesUpdatedEvent;
    "DOM.documentUpdated": DOM.DocumentUpdatedEvent;
    "DOM.inlineStyleInvalidated": DOM.InlineStyleInvalidatedEvent;
    "DOM.pseudoElementAdded": DOM.PseudoElementAddedEvent;
    "DOM.topLayerElementsUpdated": DOM.TopLayerElementsUpdatedEvent;
    "DOM.pseudoElementRemoved": DOM.PseudoElementRemovedEvent;
    "DOM.setChildNodes": DOM.SetChildNodesEvent;
    "DOM.shadowRootPopped": DOM.ShadowRootPoppedEvent;
    "DOM.shadowRootPushed": DOM.ShadowRootPushedEvent;
    "DOMStorage.domStorageItemAdded": DOMStorage.DomStorageItemAddedEvent;
    "DOMStorage.domStorageItemRemoved": DOMStorage.DomStorageItemRemovedEvent;
    "DOMStorage.domStorageItemUpdated": DOMStorage.DomStorageItemUpdatedEvent;
    "DOMStorage.domStorageItemsCleared": DOMStorage.DomStorageItemsClearedEvent;
    "Emulation.virtualTimeBudgetExpired": Emulation.VirtualTimeBudgetExpiredEvent;
    "FedCm.dialogShown": FedCm.DialogShownEvent;
    "FedCm.dialogClosed": FedCm.DialogClosedEvent;
    "Fetch.requestPaused": Fetch.RequestPausedEvent;
    "Fetch.authRequired": Fetch.AuthRequiredEvent;
    "Input.dragIntercepted": Input.DragInterceptedEvent;
    "LayerTree.layerPainted": LayerTree.LayerPaintedEvent;
    "LayerTree.layerTreeDidChange": LayerTree.LayerTreeDidChangeEvent;
    "Log.entryAdded": Log.EntryAddedEvent;
    "Media.playerPropertiesChanged": Media.PlayerPropertiesChangedEvent;
    "Media.playerEventsAdded": Media.PlayerEventsAddedEvent;
    "Media.playerMessagesLogged": Media.PlayerMessagesLoggedEvent;
    "Media.playerErrorsRaised": Media.PlayerErrorsRaisedEvent;
    "Media.playersCreated": Media.PlayersCreatedEvent;
    "Overlay.inspectNodeRequested": Overlay.InspectNodeRequestedEvent;
    "Overlay.nodeHighlightRequested": Overlay.NodeHighlightRequestedEvent;
    "Overlay.screenshotRequested": Overlay.ScreenshotRequestedEvent;
    "Overlay.inspectModeCanceled": Overlay.InspectModeCanceledEvent;
    "Page.domContentEventFired": Page.DomContentEventFiredEvent;
    "Page.fileChooserOpened": Page.FileChooserOpenedEvent;
    "Page.frameAttached": Page.FrameAttachedEvent;
    "Page.frameClearedScheduledNavigation": Page.FrameClearedScheduledNavigationEvent;
    "Page.frameDetached": Page.FrameDetachedEvent;
    "Page.frameNavigated": Page.FrameNavigatedEvent;
    "Page.documentOpened": Page.DocumentOpenedEvent;
    "Page.frameResized": Page.FrameResizedEvent;
    "Page.frameRequestedNavigation": Page.FrameRequestedNavigationEvent;
    "Page.frameScheduledNavigation": Page.FrameScheduledNavigationEvent;
    "Page.frameStartedLoading": Page.FrameStartedLoadingEvent;
    "Page.frameStoppedLoading": Page.FrameStoppedLoadingEvent;
    "Page.downloadWillBegin": Page.DownloadWillBeginEvent;
    "Page.downloadProgress": Page.DownloadProgressEvent;
    "Page.interstitialHidden": Page.InterstitialHiddenEvent;
    "Page.interstitialShown": Page.InterstitialShownEvent;
    "Page.javascriptDialogClosed": Page.JavascriptDialogClosedEvent;
    "Page.javascriptDialogOpening": Page.JavascriptDialogOpeningEvent;
    "Page.lifecycleEvent": Page.LifecycleEventEvent;
    "Page.backForwardCacheNotUsed": Page.BackForwardCacheNotUsedEvent;
    "Page.loadEventFired": Page.LoadEventFiredEvent;
    "Page.navigatedWithinDocument": Page.NavigatedWithinDocumentEvent;
    "Page.screencastFrame": Page.ScreencastFrameEvent;
    "Page.screencastVisibilityChanged": Page.ScreencastVisibilityChangedEvent;
    "Page.windowOpen": Page.WindowOpenEvent;
    "Page.compilationCacheProduced": Page.CompilationCacheProducedEvent;
    "Performance.metrics": Performance.MetricsEvent;
    "PerformanceTimeline.timelineEventAdded": PerformanceTimeline.TimelineEventAddedEvent;
    "Preload.ruleSetUpdated": Preload.RuleSetUpdatedEvent;
    "Preload.ruleSetRemoved": Preload.RuleSetRemovedEvent;
    "Preload.preloadEnabledStateUpdated": Preload.PreloadEnabledStateUpdatedEvent;
    "Preload.prefetchStatusUpdated": Preload.PrefetchStatusUpdatedEvent;
    "Preload.prerenderStatusUpdated": Preload.PrerenderStatusUpdatedEvent;
    "Preload.preloadingAttemptSourcesUpdated": Preload.PreloadingAttemptSourcesUpdatedEvent;
    "Security.certificateError": Security.CertificateErrorEvent;
    "Security.visibleSecurityStateChanged": Security.VisibleSecurityStateChangedEvent;
    "Security.securityStateChanged": Security.SecurityStateChangedEvent;
    "ServiceWorker.workerErrorReported": ServiceWorker.WorkerErrorReportedEvent;
    "ServiceWorker.workerRegistrationUpdated": ServiceWorker.WorkerRegistrationUpdatedEvent;
    "ServiceWorker.workerVersionUpdated": ServiceWorker.WorkerVersionUpdatedEvent;
    "Storage.cacheStorageContentUpdated": Storage.CacheStorageContentUpdatedEvent;
    "Storage.cacheStorageListUpdated": Storage.CacheStorageListUpdatedEvent;
    "Storage.indexedDBContentUpdated": Storage.IndexedDBContentUpdatedEvent;
    "Storage.indexedDBListUpdated": Storage.IndexedDBListUpdatedEvent;
    "Storage.interestGroupAccessed": Storage.InterestGroupAccessedEvent;
    "Storage.sharedStorageAccessed": Storage.SharedStorageAccessedEvent;
    "Storage.storageBucketCreatedOrUpdated": Storage.StorageBucketCreatedOrUpdatedEvent;
    "Storage.storageBucketDeleted": Storage.StorageBucketDeletedEvent;
    "Storage.attributionReportingSourceRegistered": Storage.AttributionReportingSourceRegisteredEvent;
    "Storage.attributionReportingTriggerRegistered": Storage.AttributionReportingTriggerRegisteredEvent;
    "Target.attachedToTarget": Target.AttachedToTargetEvent;
    "Target.detachedFromTarget": Target.DetachedFromTargetEvent;
    "Target.receivedMessageFromTarget": Target.ReceivedMessageFromTargetEvent;
    "Target.targetCreated": Target.TargetCreatedEvent;
    "Target.targetDestroyed": Target.TargetDestroyedEvent;
    "Target.targetCrashed": Target.TargetCrashedEvent;
    "Target.targetInfoChanged": Target.TargetInfoChangedEvent;
    "Tethering.accepted": Tethering.AcceptedEvent;
    "Tracing.bufferUsage": Tracing.BufferUsageEvent;
    "Tracing.dataCollected": Tracing.DataCollectedEvent;
    "Tracing.tracingComplete": Tracing.TracingCompleteEvent;
    "WebAudio.contextCreated": WebAudio.ContextCreatedEvent;
    "WebAudio.contextWillBeDestroyed": WebAudio.ContextWillBeDestroyedEvent;
    "WebAudio.contextChanged": WebAudio.ContextChangedEvent;
    "WebAudio.audioListenerCreated": WebAudio.AudioListenerCreatedEvent;
    "WebAudio.audioListenerWillBeDestroyed": WebAudio.AudioListenerWillBeDestroyedEvent;
    "WebAudio.audioNodeCreated": WebAudio.AudioNodeCreatedEvent;
    "WebAudio.audioNodeWillBeDestroyed": WebAudio.AudioNodeWillBeDestroyedEvent;
    "WebAudio.audioParamCreated": WebAudio.AudioParamCreatedEvent;
    "WebAudio.audioParamWillBeDestroyed": WebAudio.AudioParamWillBeDestroyedEvent;
    "WebAudio.nodesConnected": WebAudio.NodesConnectedEvent;
    "WebAudio.nodesDisconnected": WebAudio.NodesDisconnectedEvent;
    "WebAudio.nodeParamConnected": WebAudio.NodeParamConnectedEvent;
    "WebAudio.nodeParamDisconnected": WebAudio.NodeParamDisconnectedEvent;
    "WebAuthn.credentialAdded": WebAuthn.CredentialAddedEvent;
    "WebAuthn.credentialAsserted": WebAuthn.CredentialAssertedEvent;
  };
  export type RequestMap = {
    "Accessibility.disable": Accessibility.DisableRequest;
    "Accessibility.enable": Accessibility.EnableRequest;
    "Accessibility.getPartialAXTree": Accessibility.GetPartialAXTreeRequest;
    "Accessibility.getFullAXTree": Accessibility.GetFullAXTreeRequest;
    "Accessibility.getRootAXNode": Accessibility.GetRootAXNodeRequest;
    "Accessibility.getAXNodeAndAncestors": Accessibility.GetAXNodeAndAncestorsRequest;
    "Accessibility.getChildAXNodes": Accessibility.GetChildAXNodesRequest;
    "Accessibility.queryAXTree": Accessibility.QueryAXTreeRequest;
    "Animation.disable": Animation.DisableRequest;
    "Animation.enable": Animation.EnableRequest;
    "Animation.getCurrentTime": Animation.GetCurrentTimeRequest;
    "Animation.getPlaybackRate": Animation.GetPlaybackRateRequest;
    "Animation.releaseAnimations": Animation.ReleaseAnimationsRequest;
    "Animation.resolveAnimation": Animation.ResolveAnimationRequest;
    "Animation.seekAnimations": Animation.SeekAnimationsRequest;
    "Animation.setPaused": Animation.SetPausedRequest;
    "Animation.setPlaybackRate": Animation.SetPlaybackRateRequest;
    "Animation.setTiming": Animation.SetTimingRequest;
    "Audits.getEncodedResponse": Audits.GetEncodedResponseRequest;
    "Audits.disable": Audits.DisableRequest;
    "Audits.enable": Audits.EnableRequest;
    "Audits.checkContrast": Audits.CheckContrastRequest;
    "Audits.checkFormsIssues": Audits.CheckFormsIssuesRequest;
    "Autofill.trigger": Autofill.TriggerRequest;
    "Autofill.setAddresses": Autofill.SetAddressesRequest;
    "Autofill.disable": Autofill.DisableRequest;
    "Autofill.enable": Autofill.EnableRequest;
    "BackgroundService.startObserving": BackgroundService.StartObservingRequest;
    "BackgroundService.stopObserving": BackgroundService.StopObservingRequest;
    "BackgroundService.setRecording": BackgroundService.SetRecordingRequest;
    "BackgroundService.clearEvents": BackgroundService.ClearEventsRequest;
    "Browser.setPermission": Browser.SetPermissionRequest;
    "Browser.grantPermissions": Browser.GrantPermissionsRequest;
    "Browser.resetPermissions": Browser.ResetPermissionsRequest;
    "Browser.setDownloadBehavior": Browser.SetDownloadBehaviorRequest;
    "Browser.cancelDownload": Browser.CancelDownloadRequest;
    "Browser.close": Browser.CloseRequest;
    "Browser.crash": Browser.CrashRequest;
    "Browser.crashGpuProcess": Browser.CrashGpuProcessRequest;
    "Browser.getVersion": Browser.GetVersionRequest;
    "Browser.getBrowserCommandLine": Browser.GetBrowserCommandLineRequest;
    "Browser.getHistograms": Browser.GetHistogramsRequest;
    "Browser.getHistogram": Browser.GetHistogramRequest;
    "Browser.getWindowBounds": Browser.GetWindowBoundsRequest;
    "Browser.getWindowForTarget": Browser.GetWindowForTargetRequest;
    "Browser.setWindowBounds": Browser.SetWindowBoundsRequest;
    "Browser.setDockTile": Browser.SetDockTileRequest;
    "Browser.executeBrowserCommand": Browser.ExecuteBrowserCommandRequest;
    "Browser.addPrivacySandboxEnrollmentOverride": Browser.AddPrivacySandboxEnrollmentOverrideRequest;
    "CacheStorage.deleteCache": CacheStorage.DeleteCacheRequest;
    "CacheStorage.deleteEntry": CacheStorage.DeleteEntryRequest;
    "CacheStorage.requestCacheNames": CacheStorage.RequestCacheNamesRequest;
    "CacheStorage.requestCachedResponse": CacheStorage.RequestCachedResponseRequest;
    "CacheStorage.requestEntries": CacheStorage.RequestEntriesRequest;
    "Cast.enable": Cast.EnableRequest;
    "Cast.disable": Cast.DisableRequest;
    "Cast.setSinkToUse": Cast.SetSinkToUseRequest;
    "Cast.startDesktopMirroring": Cast.StartDesktopMirroringRequest;
    "Cast.startTabMirroring": Cast.StartTabMirroringRequest;
    "Cast.stopCasting": Cast.StopCastingRequest;
    "CSS.addRule": CSS.AddRuleRequest;
    "CSS.collectClassNames": CSS.CollectClassNamesRequest;
    "CSS.createStyleSheet": CSS.CreateStyleSheetRequest;
    "CSS.disable": CSS.DisableRequest;
    "CSS.enable": CSS.EnableRequest;
    "CSS.forcePseudoState": CSS.ForcePseudoStateRequest;
    "CSS.getBackgroundColors": CSS.GetBackgroundColorsRequest;
    "CSS.getComputedStyleForNode": CSS.GetComputedStyleForNodeRequest;
    "CSS.getInlineStylesForNode": CSS.GetInlineStylesForNodeRequest;
    "CSS.getMatchedStylesForNode": CSS.GetMatchedStylesForNodeRequest;
    "CSS.getMediaQueries": CSS.GetMediaQueriesRequest;
    "CSS.getPlatformFontsForNode": CSS.GetPlatformFontsForNodeRequest;
    "CSS.getStyleSheetText": CSS.GetStyleSheetTextRequest;
    "CSS.getLayersForNode": CSS.GetLayersForNodeRequest;
    "CSS.trackComputedStyleUpdates": CSS.TrackComputedStyleUpdatesRequest;
    "CSS.takeComputedStyleUpdates": CSS.TakeComputedStyleUpdatesRequest;
    "CSS.setEffectivePropertyValueForNode": CSS.SetEffectivePropertyValueForNodeRequest;
    "CSS.setPropertyRulePropertyName": CSS.SetPropertyRulePropertyNameRequest;
    "CSS.setKeyframeKey": CSS.SetKeyframeKeyRequest;
    "CSS.setMediaText": CSS.SetMediaTextRequest;
    "CSS.setContainerQueryText": CSS.SetContainerQueryTextRequest;
    "CSS.setSupportsText": CSS.SetSupportsTextRequest;
    "CSS.setScopeText": CSS.SetScopeTextRequest;
    "CSS.setRuleSelector": CSS.SetRuleSelectorRequest;
    "CSS.setStyleSheetText": CSS.SetStyleSheetTextRequest;
    "CSS.setStyleTexts": CSS.SetStyleTextsRequest;
    "CSS.startRuleUsageTracking": CSS.StartRuleUsageTrackingRequest;
    "CSS.stopRuleUsageTracking": CSS.StopRuleUsageTrackingRequest;
    "CSS.takeCoverageDelta": CSS.TakeCoverageDeltaRequest;
    "CSS.setLocalFontsEnabled": CSS.SetLocalFontsEnabledRequest;
    "Database.disable": Database.DisableRequest;
    "Database.enable": Database.EnableRequest;
    "Database.executeSQL": Database.ExecuteSQLRequest;
    "Database.getDatabaseTableNames": Database.GetDatabaseTableNamesRequest;
    "DeviceAccess.enable": DeviceAccess.EnableRequest;
    "DeviceAccess.disable": DeviceAccess.DisableRequest;
    "DeviceAccess.selectPrompt": DeviceAccess.SelectPromptRequest;
    "DeviceAccess.cancelPrompt": DeviceAccess.CancelPromptRequest;
    "DeviceOrientation.clearDeviceOrientationOverride": DeviceOrientation.ClearDeviceOrientationOverrideRequest;
    "DeviceOrientation.setDeviceOrientationOverride": DeviceOrientation.SetDeviceOrientationOverrideRequest;
    "DOM.collectClassNamesFromSubtree": DOM.CollectClassNamesFromSubtreeRequest;
    "DOM.copyTo": DOM.CopyToRequest;
    "DOM.describeNode": DOM.DescribeNodeRequest;
    "DOM.scrollIntoViewIfNeeded": DOM.ScrollIntoViewIfNeededRequest;
    "DOM.disable": DOM.DisableRequest;
    "DOM.discardSearchResults": DOM.DiscardSearchResultsRequest;
    "DOM.enable": DOM.EnableRequest;
    "DOM.focus": DOM.FocusRequest;
    "DOM.getAttributes": DOM.GetAttributesRequest;
    "DOM.getBoxModel": DOM.GetBoxModelRequest;
    "DOM.getContentQuads": DOM.GetContentQuadsRequest;
    "DOM.getDocument": DOM.GetDocumentRequest;
    "DOM.getFlattenedDocument": DOM.GetFlattenedDocumentRequest;
    "DOM.getNodesForSubtreeByStyle": DOM.GetNodesForSubtreeByStyleRequest;
    "DOM.getNodeForLocation": DOM.GetNodeForLocationRequest;
    "DOM.getOuterHTML": DOM.GetOuterHTMLRequest;
    "DOM.getRelayoutBoundary": DOM.GetRelayoutBoundaryRequest;
    "DOM.getSearchResults": DOM.GetSearchResultsRequest;
    "DOM.hideHighlight": DOM.HideHighlightRequest;
    "DOM.highlightNode": DOM.HighlightNodeRequest;
    "DOM.highlightRect": DOM.HighlightRectRequest;
    "DOM.markUndoableState": DOM.MarkUndoableStateRequest;
    "DOM.moveTo": DOM.MoveToRequest;
    "DOM.performSearch": DOM.PerformSearchRequest;
    "DOM.pushNodeByPathToFrontend": DOM.PushNodeByPathToFrontendRequest;
    "DOM.pushNodesByBackendIdsToFrontend": DOM.PushNodesByBackendIdsToFrontendRequest;
    "DOM.querySelector": DOM.QuerySelectorRequest;
    "DOM.querySelectorAll": DOM.QuerySelectorAllRequest;
    "DOM.getTopLayerElements": DOM.GetTopLayerElementsRequest;
    "DOM.redo": DOM.RedoRequest;
    "DOM.removeAttribute": DOM.RemoveAttributeRequest;
    "DOM.removeNode": DOM.RemoveNodeRequest;
    "DOM.requestChildNodes": DOM.RequestChildNodesRequest;
    "DOM.requestNode": DOM.RequestNodeRequest;
    "DOM.resolveNode": DOM.ResolveNodeRequest;
    "DOM.setAttributeValue": DOM.SetAttributeValueRequest;
    "DOM.setAttributesAsText": DOM.SetAttributesAsTextRequest;
    "DOM.setFileInputFiles": DOM.SetFileInputFilesRequest;
    "DOM.setNodeStackTracesEnabled": DOM.SetNodeStackTracesEnabledRequest;
    "DOM.getNodeStackTraces": DOM.GetNodeStackTracesRequest;
    "DOM.getFileInfo": DOM.GetFileInfoRequest;
    "DOM.setInspectedNode": DOM.SetInspectedNodeRequest;
    "DOM.setNodeName": DOM.SetNodeNameRequest;
    "DOM.setNodeValue": DOM.SetNodeValueRequest;
    "DOM.setOuterHTML": DOM.SetOuterHTMLRequest;
    "DOM.undo": DOM.UndoRequest;
    "DOM.getFrameOwner": DOM.GetFrameOwnerRequest;
    "DOM.getContainerForNode": DOM.GetContainerForNodeRequest;
    "DOM.getQueryingDescendantsForContainer": DOM.GetQueryingDescendantsForContainerRequest;
    "DOMDebugger.getEventListeners": DOMDebugger.GetEventListenersRequest;
    "DOMDebugger.removeDOMBreakpoint": DOMDebugger.RemoveDOMBreakpointRequest;
    "DOMDebugger.removeEventListenerBreakpoint": DOMDebugger.RemoveEventListenerBreakpointRequest;
    "DOMDebugger.removeInstrumentationBreakpoint": DOMDebugger.RemoveInstrumentationBreakpointRequest;
    "DOMDebugger.removeXHRBreakpoint": DOMDebugger.RemoveXHRBreakpointRequest;
    "DOMDebugger.setBreakOnCSPViolation": DOMDebugger.SetBreakOnCSPViolationRequest;
    "DOMDebugger.setDOMBreakpoint": DOMDebugger.SetDOMBreakpointRequest;
    "DOMDebugger.setEventListenerBreakpoint": DOMDebugger.SetEventListenerBreakpointRequest;
    "DOMDebugger.setInstrumentationBreakpoint": DOMDebugger.SetInstrumentationBreakpointRequest;
    "DOMDebugger.setXHRBreakpoint": DOMDebugger.SetXHRBreakpointRequest;
    "DOMSnapshot.disable": DOMSnapshot.DisableRequest;
    "DOMSnapshot.enable": DOMSnapshot.EnableRequest;
    "DOMSnapshot.getSnapshot": DOMSnapshot.GetSnapshotRequest;
    "DOMSnapshot.captureSnapshot": DOMSnapshot.CaptureSnapshotRequest;
    "DOMStorage.clear": DOMStorage.ClearRequest;
    "DOMStorage.disable": DOMStorage.DisableRequest;
    "DOMStorage.enable": DOMStorage.EnableRequest;
    "DOMStorage.getDOMStorageItems": DOMStorage.GetDOMStorageItemsRequest;
    "DOMStorage.removeDOMStorageItem": DOMStorage.RemoveDOMStorageItemRequest;
    "DOMStorage.setDOMStorageItem": DOMStorage.SetDOMStorageItemRequest;
    "Emulation.canEmulate": Emulation.CanEmulateRequest;
    "Emulation.clearDeviceMetricsOverride": Emulation.ClearDeviceMetricsOverrideRequest;
    "Emulation.clearGeolocationOverride": Emulation.ClearGeolocationOverrideRequest;
    "Emulation.resetPageScaleFactor": Emulation.ResetPageScaleFactorRequest;
    "Emulation.setFocusEmulationEnabled": Emulation.SetFocusEmulationEnabledRequest;
    "Emulation.setAutoDarkModeOverride": Emulation.SetAutoDarkModeOverrideRequest;
    "Emulation.setCPUThrottlingRate": Emulation.SetCPUThrottlingRateRequest;
    "Emulation.setDefaultBackgroundColorOverride": Emulation.SetDefaultBackgroundColorOverrideRequest;
    "Emulation.setDeviceMetricsOverride": Emulation.SetDeviceMetricsOverrideRequest;
    "Emulation.setScrollbarsHidden": Emulation.SetScrollbarsHiddenRequest;
    "Emulation.setDocumentCookieDisabled": Emulation.SetDocumentCookieDisabledRequest;
    "Emulation.setEmitTouchEventsForMouse": Emulation.SetEmitTouchEventsForMouseRequest;
    "Emulation.setEmulatedMedia": Emulation.SetEmulatedMediaRequest;
    "Emulation.setEmulatedVisionDeficiency": Emulation.SetEmulatedVisionDeficiencyRequest;
    "Emulation.setGeolocationOverride": Emulation.SetGeolocationOverrideRequest;
    "Emulation.getOverriddenSensorInformation": Emulation.GetOverriddenSensorInformationRequest;
    "Emulation.setSensorOverrideEnabled": Emulation.SetSensorOverrideEnabledRequest;
    "Emulation.setSensorOverrideReadings": Emulation.SetSensorOverrideReadingsRequest;
    "Emulation.setIdleOverride": Emulation.SetIdleOverrideRequest;
    "Emulation.clearIdleOverride": Emulation.ClearIdleOverrideRequest;
    "Emulation.setNavigatorOverrides": Emulation.SetNavigatorOverridesRequest;
    "Emulation.setPageScaleFactor": Emulation.SetPageScaleFactorRequest;
    "Emulation.setScriptExecutionDisabled": Emulation.SetScriptExecutionDisabledRequest;
    "Emulation.setTouchEmulationEnabled": Emulation.SetTouchEmulationEnabledRequest;
    "Emulation.setVirtualTimePolicy": Emulation.SetVirtualTimePolicyRequest;
    "Emulation.setLocaleOverride": Emulation.SetLocaleOverrideRequest;
    "Emulation.setTimezoneOverride": Emulation.SetTimezoneOverrideRequest;
    "Emulation.setVisibleSize": Emulation.SetVisibleSizeRequest;
    "Emulation.setDisabledImageTypes": Emulation.SetDisabledImageTypesRequest;
    "Emulation.setHardwareConcurrencyOverride": Emulation.SetHardwareConcurrencyOverrideRequest;
    "Emulation.setUserAgentOverride": Emulation.SetUserAgentOverrideRequest;
    "Emulation.setAutomationOverride": Emulation.SetAutomationOverrideRequest;
    "EventBreakpoints.setInstrumentationBreakpoint": EventBreakpoints.SetInstrumentationBreakpointRequest;
    "EventBreakpoints.removeInstrumentationBreakpoint": EventBreakpoints.RemoveInstrumentationBreakpointRequest;
    "EventBreakpoints.disable": EventBreakpoints.DisableRequest;
    "FedCm.enable": FedCm.EnableRequest;
    "FedCm.disable": FedCm.DisableRequest;
    "FedCm.selectAccount": FedCm.SelectAccountRequest;
    "FedCm.clickDialogButton": FedCm.ClickDialogButtonRequest;
    "FedCm.dismissDialog": FedCm.DismissDialogRequest;
    "FedCm.resetCooldown": FedCm.ResetCooldownRequest;
    "Fetch.disable": Fetch.DisableRequest;
    "Fetch.enable": Fetch.EnableRequest;
    "Fetch.failRequest": Fetch.FailRequestRequest;
    "Fetch.fulfillRequest": Fetch.FulfillRequestRequest;
    "Fetch.continueRequest": Fetch.ContinueRequestRequest;
    "Fetch.continueWithAuth": Fetch.ContinueWithAuthRequest;
    "Fetch.continueResponse": Fetch.ContinueResponseRequest;
    "Fetch.getResponseBody": Fetch.GetResponseBodyRequest;
    "Fetch.takeResponseBodyAsStream": Fetch.TakeResponseBodyAsStreamRequest;
    "HeadlessExperimental.beginFrame": HeadlessExperimental.BeginFrameRequest;
    "HeadlessExperimental.disable": HeadlessExperimental.DisableRequest;
    "HeadlessExperimental.enable": HeadlessExperimental.EnableRequest;
    "IndexedDB.clearObjectStore": IndexedDB.ClearObjectStoreRequest;
    "IndexedDB.deleteDatabase": IndexedDB.DeleteDatabaseRequest;
    "IndexedDB.deleteObjectStoreEntries": IndexedDB.DeleteObjectStoreEntriesRequest;
    "IndexedDB.disable": IndexedDB.DisableRequest;
    "IndexedDB.enable": IndexedDB.EnableRequest;
    "IndexedDB.requestData": IndexedDB.RequestDataRequest;
    "IndexedDB.getMetadata": IndexedDB.GetMetadataRequest;
    "IndexedDB.requestDatabase": IndexedDB.RequestDatabaseRequest;
    "IndexedDB.requestDatabaseNames": IndexedDB.RequestDatabaseNamesRequest;
    "Input.dispatchDragEvent": Input.DispatchDragEventRequest;
    "Input.dispatchKeyEvent": Input.DispatchKeyEventRequest;
    "Input.insertText": Input.InsertTextRequest;
    "Input.imeSetComposition": Input.ImeSetCompositionRequest;
    "Input.dispatchMouseEvent": Input.DispatchMouseEventRequest;
    "Input.dispatchTouchEvent": Input.DispatchTouchEventRequest;
    "Input.cancelDragging": Input.CancelDraggingRequest;
    "Input.emulateTouchFromMouseEvent": Input.EmulateTouchFromMouseEventRequest;
    "Input.setIgnoreInputEvents": Input.SetIgnoreInputEventsRequest;
    "Input.setInterceptDrags": Input.SetInterceptDragsRequest;
    "Input.synthesizePinchGesture": Input.SynthesizePinchGestureRequest;
    "Input.synthesizeScrollGesture": Input.SynthesizeScrollGestureRequest;
    "Input.synthesizeTapGesture": Input.SynthesizeTapGestureRequest;
    "IO.close": IO.CloseRequest;
    "IO.read": IO.ReadRequest;
    "IO.resolveBlob": IO.ResolveBlobRequest;
    "LayerTree.compositingReasons": LayerTree.CompositingReasonsRequest;
    "LayerTree.disable": LayerTree.DisableRequest;
    "LayerTree.enable": LayerTree.EnableRequest;
    "LayerTree.loadSnapshot": LayerTree.LoadSnapshotRequest;
    "LayerTree.makeSnapshot": LayerTree.MakeSnapshotRequest;
    "LayerTree.profileSnapshot": LayerTree.ProfileSnapshotRequest;
    "LayerTree.releaseSnapshot": LayerTree.ReleaseSnapshotRequest;
    "LayerTree.replaySnapshot": LayerTree.ReplaySnapshotRequest;
    "LayerTree.snapshotCommandLog": LayerTree.SnapshotCommandLogRequest;
    "Log.clear": Log.ClearRequest;
    "Log.disable": Log.DisableRequest;
    "Log.enable": Log.EnableRequest;
    "Log.startViolationsReport": Log.StartViolationsReportRequest;
    "Log.stopViolationsReport": Log.StopViolationsReportRequest;
    "Media.enable": Media.EnableRequest;
    "Media.disable": Media.DisableRequest;
    "Overlay.disable": Overlay.DisableRequest;
    "Overlay.enable": Overlay.EnableRequest;
    "Overlay.getHighlightObjectForTest": Overlay.GetHighlightObjectForTestRequest;
    "Overlay.getGridHighlightObjectsForTest": Overlay.GetGridHighlightObjectsForTestRequest;
    "Overlay.getSourceOrderHighlightObjectForTest": Overlay.GetSourceOrderHighlightObjectForTestRequest;
    "Overlay.hideHighlight": Overlay.HideHighlightRequest;
    "Overlay.highlightFrame": Overlay.HighlightFrameRequest;
    "Overlay.highlightNode": Overlay.HighlightNodeRequest;
    "Overlay.highlightQuad": Overlay.HighlightQuadRequest;
    "Overlay.highlightRect": Overlay.HighlightRectRequest;
    "Overlay.highlightSourceOrder": Overlay.HighlightSourceOrderRequest;
    "Overlay.setInspectMode": Overlay.SetInspectModeRequest;
    "Overlay.setShowAdHighlights": Overlay.SetShowAdHighlightsRequest;
    "Overlay.setPausedInDebuggerMessage": Overlay.SetPausedInDebuggerMessageRequest;
    "Overlay.setShowDebugBorders": Overlay.SetShowDebugBordersRequest;
    "Overlay.setShowFPSCounter": Overlay.SetShowFPSCounterRequest;
    "Overlay.setShowGridOverlays": Overlay.SetShowGridOverlaysRequest;
    "Overlay.setShowFlexOverlays": Overlay.SetShowFlexOverlaysRequest;
    "Overlay.setShowScrollSnapOverlays": Overlay.SetShowScrollSnapOverlaysRequest;
    "Overlay.setShowContainerQueryOverlays": Overlay.SetShowContainerQueryOverlaysRequest;
    "Overlay.setShowPaintRects": Overlay.SetShowPaintRectsRequest;
    "Overlay.setShowLayoutShiftRegions": Overlay.SetShowLayoutShiftRegionsRequest;
    "Overlay.setShowScrollBottleneckRects": Overlay.SetShowScrollBottleneckRectsRequest;
    "Overlay.setShowHitTestBorders": Overlay.SetShowHitTestBordersRequest;
    "Overlay.setShowWebVitals": Overlay.SetShowWebVitalsRequest;
    "Overlay.setShowViewportSizeOnResize": Overlay.SetShowViewportSizeOnResizeRequest;
    "Overlay.setShowHinge": Overlay.SetShowHingeRequest;
    "Overlay.setShowIsolatedElements": Overlay.SetShowIsolatedElementsRequest;
    "Overlay.setShowWindowControlsOverlay": Overlay.SetShowWindowControlsOverlayRequest;
    "Page.addScriptToEvaluateOnLoad": Page.AddScriptToEvaluateOnLoadRequest;
    "Page.addScriptToEvaluateOnNewDocument": Page.AddScriptToEvaluateOnNewDocumentRequest;
    "Page.bringToFront": Page.BringToFrontRequest;
    "Page.captureScreenshot": Page.CaptureScreenshotRequest;
    "Page.captureSnapshot": Page.CaptureSnapshotRequest;
    "Page.clearDeviceMetricsOverride": Page.ClearDeviceMetricsOverrideRequest;
    "Page.clearDeviceOrientationOverride": Page.ClearDeviceOrientationOverrideRequest;
    "Page.clearGeolocationOverride": Page.ClearGeolocationOverrideRequest;
    "Page.createIsolatedWorld": Page.CreateIsolatedWorldRequest;
    "Page.deleteCookie": Page.DeleteCookieRequest;
    "Page.disable": Page.DisableRequest;
    "Page.enable": Page.EnableRequest;
    "Page.getAppManifest": Page.GetAppManifestRequest;
    "Page.getInstallabilityErrors": Page.GetInstallabilityErrorsRequest;
    "Page.getManifestIcons": Page.GetManifestIconsRequest;
    "Page.getAppId": Page.GetAppIdRequest;
    "Page.getAdScriptId": Page.GetAdScriptIdRequest;
    "Page.getFrameTree": Page.GetFrameTreeRequest;
    "Page.getLayoutMetrics": Page.GetLayoutMetricsRequest;
    "Page.getNavigationHistory": Page.GetNavigationHistoryRequest;
    "Page.resetNavigationHistory": Page.ResetNavigationHistoryRequest;
    "Page.getResourceContent": Page.GetResourceContentRequest;
    "Page.getResourceTree": Page.GetResourceTreeRequest;
    "Page.handleJavaScriptDialog": Page.HandleJavaScriptDialogRequest;
    "Page.navigate": Page.NavigateRequest;
    "Page.navigateToHistoryEntry": Page.NavigateToHistoryEntryRequest;
    "Page.printToPDF": Page.PrintToPDFRequest;
    "Page.reload": Page.ReloadRequest;
    "Page.removeScriptToEvaluateOnLoad": Page.RemoveScriptToEvaluateOnLoadRequest;
    "Page.removeScriptToEvaluateOnNewDocument": Page.RemoveScriptToEvaluateOnNewDocumentRequest;
    "Page.screencastFrameAck": Page.ScreencastFrameAckRequest;
    "Page.searchInResource": Page.SearchInResourceRequest;
    "Page.setAdBlockingEnabled": Page.SetAdBlockingEnabledRequest;
    "Page.setBypassCSP": Page.SetBypassCSPRequest;
    "Page.getPermissionsPolicyState": Page.GetPermissionsPolicyStateRequest;
    "Page.getOriginTrials": Page.GetOriginTrialsRequest;
    "Page.setDeviceMetricsOverride": Page.SetDeviceMetricsOverrideRequest;
    "Page.setDeviceOrientationOverride": Page.SetDeviceOrientationOverrideRequest;
    "Page.setFontFamilies": Page.SetFontFamiliesRequest;
    "Page.setFontSizes": Page.SetFontSizesRequest;
    "Page.setDocumentContent": Page.SetDocumentContentRequest;
    "Page.setDownloadBehavior": Page.SetDownloadBehaviorRequest;
    "Page.setGeolocationOverride": Page.SetGeolocationOverrideRequest;
    "Page.setLifecycleEventsEnabled": Page.SetLifecycleEventsEnabledRequest;
    "Page.setTouchEmulationEnabled": Page.SetTouchEmulationEnabledRequest;
    "Page.startScreencast": Page.StartScreencastRequest;
    "Page.stopLoading": Page.StopLoadingRequest;
    "Page.crash": Page.CrashRequest;
    "Page.close": Page.CloseRequest;
    "Page.setWebLifecycleState": Page.SetWebLifecycleStateRequest;
    "Page.stopScreencast": Page.StopScreencastRequest;
    "Page.produceCompilationCache": Page.ProduceCompilationCacheRequest;
    "Page.addCompilationCache": Page.AddCompilationCacheRequest;
    "Page.clearCompilationCache": Page.ClearCompilationCacheRequest;
    "Page.setSPCTransactionMode": Page.SetSPCTransactionModeRequest;
    "Page.setRPHRegistrationMode": Page.SetRPHRegistrationModeRequest;
    "Page.generateTestReport": Page.GenerateTestReportRequest;
    "Page.waitForDebugger": Page.WaitForDebuggerRequest;
    "Page.setInterceptFileChooserDialog": Page.SetInterceptFileChooserDialogRequest;
    "Page.setPrerenderingAllowed": Page.SetPrerenderingAllowedRequest;
    "Performance.disable": Performance.DisableRequest;
    "Performance.enable": Performance.EnableRequest;
    "Performance.setTimeDomain": Performance.SetTimeDomainRequest;
    "Performance.getMetrics": Performance.GetMetricsRequest;
    "PerformanceTimeline.enable": PerformanceTimeline.EnableRequest;
    "Preload.enable": Preload.EnableRequest;
    "Preload.disable": Preload.DisableRequest;
    "Schema.getDomains": Schema.GetDomainsRequest;
    "Security.disable": Security.DisableRequest;
    "Security.enable": Security.EnableRequest;
    "Security.setIgnoreCertificateErrors": Security.SetIgnoreCertificateErrorsRequest;
    "Security.handleCertificateError": Security.HandleCertificateErrorRequest;
    "Security.setOverrideCertificateErrors": Security.SetOverrideCertificateErrorsRequest;
    "ServiceWorker.deliverPushMessage": ServiceWorker.DeliverPushMessageRequest;
    "ServiceWorker.disable": ServiceWorker.DisableRequest;
    "ServiceWorker.dispatchSyncEvent": ServiceWorker.DispatchSyncEventRequest;
    "ServiceWorker.dispatchPeriodicSyncEvent": ServiceWorker.DispatchPeriodicSyncEventRequest;
    "ServiceWorker.enable": ServiceWorker.EnableRequest;
    "ServiceWorker.inspectWorker": ServiceWorker.InspectWorkerRequest;
    "ServiceWorker.setForceUpdateOnPageLoad": ServiceWorker.SetForceUpdateOnPageLoadRequest;
    "ServiceWorker.skipWaiting": ServiceWorker.SkipWaitingRequest;
    "ServiceWorker.startWorker": ServiceWorker.StartWorkerRequest;
    "ServiceWorker.stopAllWorkers": ServiceWorker.StopAllWorkersRequest;
    "ServiceWorker.stopWorker": ServiceWorker.StopWorkerRequest;
    "ServiceWorker.unregister": ServiceWorker.UnregisterRequest;
    "ServiceWorker.updateRegistration": ServiceWorker.UpdateRegistrationRequest;
    "Storage.getStorageKeyForFrame": Storage.GetStorageKeyForFrameRequest;
    "Storage.clearDataForOrigin": Storage.ClearDataForOriginRequest;
    "Storage.clearDataForStorageKey": Storage.ClearDataForStorageKeyRequest;
    "Storage.getCookies": Storage.GetCookiesRequest;
    "Storage.setCookies": Storage.SetCookiesRequest;
    "Storage.clearCookies": Storage.ClearCookiesRequest;
    "Storage.getUsageAndQuota": Storage.GetUsageAndQuotaRequest;
    "Storage.overrideQuotaForOrigin": Storage.OverrideQuotaForOriginRequest;
    "Storage.trackCacheStorageForOrigin": Storage.TrackCacheStorageForOriginRequest;
    "Storage.trackCacheStorageForStorageKey": Storage.TrackCacheStorageForStorageKeyRequest;
    "Storage.trackIndexedDBForOrigin": Storage.TrackIndexedDBForOriginRequest;
    "Storage.trackIndexedDBForStorageKey": Storage.TrackIndexedDBForStorageKeyRequest;
    "Storage.untrackCacheStorageForOrigin": Storage.UntrackCacheStorageForOriginRequest;
    "Storage.untrackCacheStorageForStorageKey": Storage.UntrackCacheStorageForStorageKeyRequest;
    "Storage.untrackIndexedDBForOrigin": Storage.UntrackIndexedDBForOriginRequest;
    "Storage.untrackIndexedDBForStorageKey": Storage.UntrackIndexedDBForStorageKeyRequest;
    "Storage.getTrustTokens": Storage.GetTrustTokensRequest;
    "Storage.clearTrustTokens": Storage.ClearTrustTokensRequest;
    "Storage.getInterestGroupDetails": Storage.GetInterestGroupDetailsRequest;
    "Storage.setInterestGroupTracking": Storage.SetInterestGroupTrackingRequest;
    "Storage.getSharedStorageMetadata": Storage.GetSharedStorageMetadataRequest;
    "Storage.getSharedStorageEntries": Storage.GetSharedStorageEntriesRequest;
    "Storage.setSharedStorageEntry": Storage.SetSharedStorageEntryRequest;
    "Storage.deleteSharedStorageEntry": Storage.DeleteSharedStorageEntryRequest;
    "Storage.clearSharedStorageEntries": Storage.ClearSharedStorageEntriesRequest;
    "Storage.resetSharedStorageBudget": Storage.ResetSharedStorageBudgetRequest;
    "Storage.setSharedStorageTracking": Storage.SetSharedStorageTrackingRequest;
    "Storage.setStorageBucketTracking": Storage.SetStorageBucketTrackingRequest;
    "Storage.deleteStorageBucket": Storage.DeleteStorageBucketRequest;
    "Storage.runBounceTrackingMitigations": Storage.RunBounceTrackingMitigationsRequest;
    "Storage.setAttributionReportingLocalTestingMode": Storage.SetAttributionReportingLocalTestingModeRequest;
    "Storage.setAttributionReportingTracking": Storage.SetAttributionReportingTrackingRequest;
    "SystemInfo.getInfo": SystemInfo.GetInfoRequest;
    "SystemInfo.getFeatureState": SystemInfo.GetFeatureStateRequest;
    "SystemInfo.getProcessInfo": SystemInfo.GetProcessInfoRequest;
    "Target.activateTarget": Target.ActivateTargetRequest;
    "Target.attachToTarget": Target.AttachToTargetRequest;
    "Target.attachToBrowserTarget": Target.AttachToBrowserTargetRequest;
    "Target.closeTarget": Target.CloseTargetRequest;
    "Target.exposeDevToolsProtocol": Target.ExposeDevToolsProtocolRequest;
    "Target.createBrowserContext": Target.CreateBrowserContextRequest;
    "Target.getBrowserContexts": Target.GetBrowserContextsRequest;
    "Target.createTarget": Target.CreateTargetRequest;
    "Target.detachFromTarget": Target.DetachFromTargetRequest;
    "Target.disposeBrowserContext": Target.DisposeBrowserContextRequest;
    "Target.getTargetInfo": Target.GetTargetInfoRequest;
    "Target.getTargets": Target.GetTargetsRequest;
    "Target.sendMessageToTarget": Target.SendMessageToTargetRequest;
    "Target.setAutoAttach": Target.SetAutoAttachRequest;
    "Target.autoAttachRelated": Target.AutoAttachRelatedRequest;
    "Target.setDiscoverTargets": Target.SetDiscoverTargetsRequest;
    "Target.setRemoteLocations": Target.SetRemoteLocationsRequest;
    "Tethering.bind": Tethering.BindRequest;
    "Tethering.unbind": Tethering.UnbindRequest;
    "Tracing.end": Tracing.EndRequest;
    "Tracing.getCategories": Tracing.GetCategoriesRequest;
    "Tracing.recordClockSyncMarker": Tracing.RecordClockSyncMarkerRequest;
    "Tracing.requestMemoryDump": Tracing.RequestMemoryDumpRequest;
    "Tracing.start": Tracing.StartRequest;
    "WebAudio.enable": WebAudio.EnableRequest;
    "WebAudio.disable": WebAudio.DisableRequest;
    "WebAudio.getRealtimeData": WebAudio.GetRealtimeDataRequest;
    "WebAuthn.enable": WebAuthn.EnableRequest;
    "WebAuthn.disable": WebAuthn.DisableRequest;
    "WebAuthn.addVirtualAuthenticator": WebAuthn.AddVirtualAuthenticatorRequest;
    "WebAuthn.setResponseOverrideBits": WebAuthn.SetResponseOverrideBitsRequest;
    "WebAuthn.removeVirtualAuthenticator": WebAuthn.RemoveVirtualAuthenticatorRequest;
    "WebAuthn.addCredential": WebAuthn.AddCredentialRequest;
    "WebAuthn.getCredential": WebAuthn.GetCredentialRequest;
    "WebAuthn.getCredentials": WebAuthn.GetCredentialsRequest;
    "WebAuthn.removeCredential": WebAuthn.RemoveCredentialRequest;
    "WebAuthn.clearCredentials": WebAuthn.ClearCredentialsRequest;
    "WebAuthn.setUserVerified": WebAuthn.SetUserVerifiedRequest;
    "WebAuthn.setAutomaticPresenceSimulation": WebAuthn.SetAutomaticPresenceSimulationRequest;
  };
  export type ResponseMap = {
    "Accessibility.disable": Accessibility.DisableResponse;
    "Accessibility.enable": Accessibility.EnableResponse;
    "Accessibility.getPartialAXTree": Accessibility.GetPartialAXTreeResponse;
    "Accessibility.getFullAXTree": Accessibility.GetFullAXTreeResponse;
    "Accessibility.getRootAXNode": Accessibility.GetRootAXNodeResponse;
    "Accessibility.getAXNodeAndAncestors": Accessibility.GetAXNodeAndAncestorsResponse;
    "Accessibility.getChildAXNodes": Accessibility.GetChildAXNodesResponse;
    "Accessibility.queryAXTree": Accessibility.QueryAXTreeResponse;
    "Animation.disable": Animation.DisableResponse;
    "Animation.enable": Animation.EnableResponse;
    "Animation.getCurrentTime": Animation.GetCurrentTimeResponse;
    "Animation.getPlaybackRate": Animation.GetPlaybackRateResponse;
    "Animation.releaseAnimations": Animation.ReleaseAnimationsResponse;
    "Animation.resolveAnimation": Animation.ResolveAnimationResponse;
    "Animation.seekAnimations": Animation.SeekAnimationsResponse;
    "Animation.setPaused": Animation.SetPausedResponse;
    "Animation.setPlaybackRate": Animation.SetPlaybackRateResponse;
    "Animation.setTiming": Animation.SetTimingResponse;
    "Audits.getEncodedResponse": Audits.GetEncodedResponseResponse;
    "Audits.disable": Audits.DisableResponse;
    "Audits.enable": Audits.EnableResponse;
    "Audits.checkContrast": Audits.CheckContrastResponse;
    "Audits.checkFormsIssues": Audits.CheckFormsIssuesResponse;
    "Autofill.trigger": Autofill.TriggerResponse;
    "Autofill.setAddresses": Autofill.SetAddressesResponse;
    "Autofill.disable": Autofill.DisableResponse;
    "Autofill.enable": Autofill.EnableResponse;
    "BackgroundService.startObserving": BackgroundService.StartObservingResponse;
    "BackgroundService.stopObserving": BackgroundService.StopObservingResponse;
    "BackgroundService.setRecording": BackgroundService.SetRecordingResponse;
    "BackgroundService.clearEvents": BackgroundService.ClearEventsResponse;
    "Browser.setPermission": Browser.SetPermissionResponse;
    "Browser.grantPermissions": Browser.GrantPermissionsResponse;
    "Browser.resetPermissions": Browser.ResetPermissionsResponse;
    "Browser.setDownloadBehavior": Browser.SetDownloadBehaviorResponse;
    "Browser.cancelDownload": Browser.CancelDownloadResponse;
    "Browser.close": Browser.CloseResponse;
    "Browser.crash": Browser.CrashResponse;
    "Browser.crashGpuProcess": Browser.CrashGpuProcessResponse;
    "Browser.getVersion": Browser.GetVersionResponse;
    "Browser.getBrowserCommandLine": Browser.GetBrowserCommandLineResponse;
    "Browser.getHistograms": Browser.GetHistogramsResponse;
    "Browser.getHistogram": Browser.GetHistogramResponse;
    "Browser.getWindowBounds": Browser.GetWindowBoundsResponse;
    "Browser.getWindowForTarget": Browser.GetWindowForTargetResponse;
    "Browser.setWindowBounds": Browser.SetWindowBoundsResponse;
    "Browser.setDockTile": Browser.SetDockTileResponse;
    "Browser.executeBrowserCommand": Browser.ExecuteBrowserCommandResponse;
    "Browser.addPrivacySandboxEnrollmentOverride": Browser.AddPrivacySandboxEnrollmentOverrideResponse;
    "CacheStorage.deleteCache": CacheStorage.DeleteCacheResponse;
    "CacheStorage.deleteEntry": CacheStorage.DeleteEntryResponse;
    "CacheStorage.requestCacheNames": CacheStorage.RequestCacheNamesResponse;
    "CacheStorage.requestCachedResponse": CacheStorage.RequestCachedResponseResponse;
    "CacheStorage.requestEntries": CacheStorage.RequestEntriesResponse;
    "Cast.enable": Cast.EnableResponse;
    "Cast.disable": Cast.DisableResponse;
    "Cast.setSinkToUse": Cast.SetSinkToUseResponse;
    "Cast.startDesktopMirroring": Cast.StartDesktopMirroringResponse;
    "Cast.startTabMirroring": Cast.StartTabMirroringResponse;
    "Cast.stopCasting": Cast.StopCastingResponse;
    "CSS.addRule": CSS.AddRuleResponse;
    "CSS.collectClassNames": CSS.CollectClassNamesResponse;
    "CSS.createStyleSheet": CSS.CreateStyleSheetResponse;
    "CSS.disable": CSS.DisableResponse;
    "CSS.enable": CSS.EnableResponse;
    "CSS.forcePseudoState": CSS.ForcePseudoStateResponse;
    "CSS.getBackgroundColors": CSS.GetBackgroundColorsResponse;
    "CSS.getComputedStyleForNode": CSS.GetComputedStyleForNodeResponse;
    "CSS.getInlineStylesForNode": CSS.GetInlineStylesForNodeResponse;
    "CSS.getMatchedStylesForNode": CSS.GetMatchedStylesForNodeResponse;
    "CSS.getMediaQueries": CSS.GetMediaQueriesResponse;
    "CSS.getPlatformFontsForNode": CSS.GetPlatformFontsForNodeResponse;
    "CSS.getStyleSheetText": CSS.GetStyleSheetTextResponse;
    "CSS.getLayersForNode": CSS.GetLayersForNodeResponse;
    "CSS.trackComputedStyleUpdates": CSS.TrackComputedStyleUpdatesResponse;
    "CSS.takeComputedStyleUpdates": CSS.TakeComputedStyleUpdatesResponse;
    "CSS.setEffectivePropertyValueForNode": CSS.SetEffectivePropertyValueForNodeResponse;
    "CSS.setPropertyRulePropertyName": CSS.SetPropertyRulePropertyNameResponse;
    "CSS.setKeyframeKey": CSS.SetKeyframeKeyResponse;
    "CSS.setMediaText": CSS.SetMediaTextResponse;
    "CSS.setContainerQueryText": CSS.SetContainerQueryTextResponse;
    "CSS.setSupportsText": CSS.SetSupportsTextResponse;
    "CSS.setScopeText": CSS.SetScopeTextResponse;
    "CSS.setRuleSelector": CSS.SetRuleSelectorResponse;
    "CSS.setStyleSheetText": CSS.SetStyleSheetTextResponse;
    "CSS.setStyleTexts": CSS.SetStyleTextsResponse;
    "CSS.startRuleUsageTracking": CSS.StartRuleUsageTrackingResponse;
    "CSS.stopRuleUsageTracking": CSS.StopRuleUsageTrackingResponse;
    "CSS.takeCoverageDelta": CSS.TakeCoverageDeltaResponse;
    "CSS.setLocalFontsEnabled": CSS.SetLocalFontsEnabledResponse;
    "Database.disable": Database.DisableResponse;
    "Database.enable": Database.EnableResponse;
    "Database.executeSQL": Database.ExecuteSQLResponse;
    "Database.getDatabaseTableNames": Database.GetDatabaseTableNamesResponse;
    "DeviceAccess.enable": DeviceAccess.EnableResponse;
    "DeviceAccess.disable": DeviceAccess.DisableResponse;
    "DeviceAccess.selectPrompt": DeviceAccess.SelectPromptResponse;
    "DeviceAccess.cancelPrompt": DeviceAccess.CancelPromptResponse;
    "DeviceOrientation.clearDeviceOrientationOverride": DeviceOrientation.ClearDeviceOrientationOverrideResponse;
    "DeviceOrientation.setDeviceOrientationOverride": DeviceOrientation.SetDeviceOrientationOverrideResponse;
    "DOM.collectClassNamesFromSubtree": DOM.CollectClassNamesFromSubtreeResponse;
    "DOM.copyTo": DOM.CopyToResponse;
    "DOM.describeNode": DOM.DescribeNodeResponse;
    "DOM.scrollIntoViewIfNeeded": DOM.ScrollIntoViewIfNeededResponse;
    "DOM.disable": DOM.DisableResponse;
    "DOM.discardSearchResults": DOM.DiscardSearchResultsResponse;
    "DOM.enable": DOM.EnableResponse;
    "DOM.focus": DOM.FocusResponse;
    "DOM.getAttributes": DOM.GetAttributesResponse;
    "DOM.getBoxModel": DOM.GetBoxModelResponse;
    "DOM.getContentQuads": DOM.GetContentQuadsResponse;
    "DOM.getDocument": DOM.GetDocumentResponse;
    "DOM.getFlattenedDocument": DOM.GetFlattenedDocumentResponse;
    "DOM.getNodesForSubtreeByStyle": DOM.GetNodesForSubtreeByStyleResponse;
    "DOM.getNodeForLocation": DOM.GetNodeForLocationResponse;
    "DOM.getOuterHTML": DOM.GetOuterHTMLResponse;
    "DOM.getRelayoutBoundary": DOM.GetRelayoutBoundaryResponse;
    "DOM.getSearchResults": DOM.GetSearchResultsResponse;
    "DOM.hideHighlight": DOM.HideHighlightResponse;
    "DOM.highlightNode": DOM.HighlightNodeResponse;
    "DOM.highlightRect": DOM.HighlightRectResponse;
    "DOM.markUndoableState": DOM.MarkUndoableStateResponse;
    "DOM.moveTo": DOM.MoveToResponse;
    "DOM.performSearch": DOM.PerformSearchResponse;
    "DOM.pushNodeByPathToFrontend": DOM.PushNodeByPathToFrontendResponse;
    "DOM.pushNodesByBackendIdsToFrontend": DOM.PushNodesByBackendIdsToFrontendResponse;
    "DOM.querySelector": DOM.QuerySelectorResponse;
    "DOM.querySelectorAll": DOM.QuerySelectorAllResponse;
    "DOM.getTopLayerElements": DOM.GetTopLayerElementsResponse;
    "DOM.redo": DOM.RedoResponse;
    "DOM.removeAttribute": DOM.RemoveAttributeResponse;
    "DOM.removeNode": DOM.RemoveNodeResponse;
    "DOM.requestChildNodes": DOM.RequestChildNodesResponse;
    "DOM.requestNode": DOM.RequestNodeResponse;
    "DOM.resolveNode": DOM.ResolveNodeResponse;
    "DOM.setAttributeValue": DOM.SetAttributeValueResponse;
    "DOM.setAttributesAsText": DOM.SetAttributesAsTextResponse;
    "DOM.setFileInputFiles": DOM.SetFileInputFilesResponse;
    "DOM.setNodeStackTracesEnabled": DOM.SetNodeStackTracesEnabledResponse;
    "DOM.getNodeStackTraces": DOM.GetNodeStackTracesResponse;
    "DOM.getFileInfo": DOM.GetFileInfoResponse;
    "DOM.setInspectedNode": DOM.SetInspectedNodeResponse;
    "DOM.setNodeName": DOM.SetNodeNameResponse;
    "DOM.setNodeValue": DOM.SetNodeValueResponse;
    "DOM.setOuterHTML": DOM.SetOuterHTMLResponse;
    "DOM.undo": DOM.UndoResponse;
    "DOM.getFrameOwner": DOM.GetFrameOwnerResponse;
    "DOM.getContainerForNode": DOM.GetContainerForNodeResponse;
    "DOM.getQueryingDescendantsForContainer": DOM.GetQueryingDescendantsForContainerResponse;
    "DOMDebugger.getEventListeners": DOMDebugger.GetEventListenersResponse;
    "DOMDebugger.removeDOMBreakpoint": DOMDebugger.RemoveDOMBreakpointResponse;
    "DOMDebugger.removeEventListenerBreakpoint": DOMDebugger.RemoveEventListenerBreakpointResponse;
    "DOMDebugger.removeInstrumentationBreakpoint": DOMDebugger.RemoveInstrumentationBreakpointResponse;
    "DOMDebugger.removeXHRBreakpoint": DOMDebugger.RemoveXHRBreakpointResponse;
    "DOMDebugger.setBreakOnCSPViolation": DOMDebugger.SetBreakOnCSPViolationResponse;
    "DOMDebugger.setDOMBreakpoint": DOMDebugger.SetDOMBreakpointResponse;
    "DOMDebugger.setEventListenerBreakpoint": DOMDebugger.SetEventListenerBreakpointResponse;
    "DOMDebugger.setInstrumentationBreakpoint": DOMDebugger.SetInstrumentationBreakpointResponse;
    "DOMDebugger.setXHRBreakpoint": DOMDebugger.SetXHRBreakpointResponse;
    "DOMSnapshot.disable": DOMSnapshot.DisableResponse;
    "DOMSnapshot.enable": DOMSnapshot.EnableResponse;
    "DOMSnapshot.getSnapshot": DOMSnapshot.GetSnapshotResponse;
    "DOMSnapshot.captureSnapshot": DOMSnapshot.CaptureSnapshotResponse;
    "DOMStorage.clear": DOMStorage.ClearResponse;
    "DOMStorage.disable": DOMStorage.DisableResponse;
    "DOMStorage.enable": DOMStorage.EnableResponse;
    "DOMStorage.getDOMStorageItems": DOMStorage.GetDOMStorageItemsResponse;
    "DOMStorage.removeDOMStorageItem": DOMStorage.RemoveDOMStorageItemResponse;
    "DOMStorage.setDOMStorageItem": DOMStorage.SetDOMStorageItemResponse;
    "Emulation.canEmulate": Emulation.CanEmulateResponse;
    "Emulation.clearDeviceMetricsOverride": Emulation.ClearDeviceMetricsOverrideResponse;
    "Emulation.clearGeolocationOverride": Emulation.ClearGeolocationOverrideResponse;
    "Emulation.resetPageScaleFactor": Emulation.ResetPageScaleFactorResponse;
    "Emulation.setFocusEmulationEnabled": Emulation.SetFocusEmulationEnabledResponse;
    "Emulation.setAutoDarkModeOverride": Emulation.SetAutoDarkModeOverrideResponse;
    "Emulation.setCPUThrottlingRate": Emulation.SetCPUThrottlingRateResponse;
    "Emulation.setDefaultBackgroundColorOverride": Emulation.SetDefaultBackgroundColorOverrideResponse;
    "Emulation.setDeviceMetricsOverride": Emulation.SetDeviceMetricsOverrideResponse;
    "Emulation.setScrollbarsHidden": Emulation.SetScrollbarsHiddenResponse;
    "Emulation.setDocumentCookieDisabled": Emulation.SetDocumentCookieDisabledResponse;
    "Emulation.setEmitTouchEventsForMouse": Emulation.SetEmitTouchEventsForMouseResponse;
    "Emulation.setEmulatedMedia": Emulation.SetEmulatedMediaResponse;
    "Emulation.setEmulatedVisionDeficiency": Emulation.SetEmulatedVisionDeficiencyResponse;
    "Emulation.setGeolocationOverride": Emulation.SetGeolocationOverrideResponse;
    "Emulation.getOverriddenSensorInformation": Emulation.GetOverriddenSensorInformationResponse;
    "Emulation.setSensorOverrideEnabled": Emulation.SetSensorOverrideEnabledResponse;
    "Emulation.setSensorOverrideReadings": Emulation.SetSensorOverrideReadingsResponse;
    "Emulation.setIdleOverride": Emulation.SetIdleOverrideResponse;
    "Emulation.clearIdleOverride": Emulation.ClearIdleOverrideResponse;
    "Emulation.setNavigatorOverrides": Emulation.SetNavigatorOverridesResponse;
    "Emulation.setPageScaleFactor": Emulation.SetPageScaleFactorResponse;
    "Emulation.setScriptExecutionDisabled": Emulation.SetScriptExecutionDisabledResponse;
    "Emulation.setTouchEmulationEnabled": Emulation.SetTouchEmulationEnabledResponse;
    "Emulation.setVirtualTimePolicy": Emulation.SetVirtualTimePolicyResponse;
    "Emulation.setLocaleOverride": Emulation.SetLocaleOverrideResponse;
    "Emulation.setTimezoneOverride": Emulation.SetTimezoneOverrideResponse;
    "Emulation.setVisibleSize": Emulation.SetVisibleSizeResponse;
    "Emulation.setDisabledImageTypes": Emulation.SetDisabledImageTypesResponse;
    "Emulation.setHardwareConcurrencyOverride": Emulation.SetHardwareConcurrencyOverrideResponse;
    "Emulation.setUserAgentOverride": Emulation.SetUserAgentOverrideResponse;
    "Emulation.setAutomationOverride": Emulation.SetAutomationOverrideResponse;
    "EventBreakpoints.setInstrumentationBreakpoint": EventBreakpoints.SetInstrumentationBreakpointResponse;
    "EventBreakpoints.removeInstrumentationBreakpoint": EventBreakpoints.RemoveInstrumentationBreakpointResponse;
    "EventBreakpoints.disable": EventBreakpoints.DisableResponse;
    "FedCm.enable": FedCm.EnableResponse;
    "FedCm.disable": FedCm.DisableResponse;
    "FedCm.selectAccount": FedCm.SelectAccountResponse;
    "FedCm.clickDialogButton": FedCm.ClickDialogButtonResponse;
    "FedCm.dismissDialog": FedCm.DismissDialogResponse;
    "FedCm.resetCooldown": FedCm.ResetCooldownResponse;
    "Fetch.disable": Fetch.DisableResponse;
    "Fetch.enable": Fetch.EnableResponse;
    "Fetch.failRequest": Fetch.FailRequestResponse;
    "Fetch.fulfillRequest": Fetch.FulfillRequestResponse;
    "Fetch.continueRequest": Fetch.ContinueRequestResponse;
    "Fetch.continueWithAuth": Fetch.ContinueWithAuthResponse;
    "Fetch.continueResponse": Fetch.ContinueResponseResponse;
    "Fetch.getResponseBody": Fetch.GetResponseBodyResponse;
    "Fetch.takeResponseBodyAsStream": Fetch.TakeResponseBodyAsStreamResponse;
    "HeadlessExperimental.beginFrame": HeadlessExperimental.BeginFrameResponse;
    "HeadlessExperimental.disable": HeadlessExperimental.DisableResponse;
    "HeadlessExperimental.enable": HeadlessExperimental.EnableResponse;
    "IndexedDB.clearObjectStore": IndexedDB.ClearObjectStoreResponse;
    "IndexedDB.deleteDatabase": IndexedDB.DeleteDatabaseResponse;
    "IndexedDB.deleteObjectStoreEntries": IndexedDB.DeleteObjectStoreEntriesResponse;
    "IndexedDB.disable": IndexedDB.DisableResponse;
    "IndexedDB.enable": IndexedDB.EnableResponse;
    "IndexedDB.requestData": IndexedDB.RequestDataResponse;
    "IndexedDB.getMetadata": IndexedDB.GetMetadataResponse;
    "IndexedDB.requestDatabase": IndexedDB.RequestDatabaseResponse;
    "IndexedDB.requestDatabaseNames": IndexedDB.RequestDatabaseNamesResponse;
    "Input.dispatchDragEvent": Input.DispatchDragEventResponse;
    "Input.dispatchKeyEvent": Input.DispatchKeyEventResponse;
    "Input.insertText": Input.InsertTextResponse;
    "Input.imeSetComposition": Input.ImeSetCompositionResponse;
    "Input.dispatchMouseEvent": Input.DispatchMouseEventResponse;
    "Input.dispatchTouchEvent": Input.DispatchTouchEventResponse;
    "Input.cancelDragging": Input.CancelDraggingResponse;
    "Input.emulateTouchFromMouseEvent": Input.EmulateTouchFromMouseEventResponse;
    "Input.setIgnoreInputEvents": Input.SetIgnoreInputEventsResponse;
    "Input.setInterceptDrags": Input.SetInterceptDragsResponse;
    "Input.synthesizePinchGesture": Input.SynthesizePinchGestureResponse;
    "Input.synthesizeScrollGesture": Input.SynthesizeScrollGestureResponse;
    "Input.synthesizeTapGesture": Input.SynthesizeTapGestureResponse;
    "IO.close": IO.CloseResponse;
    "IO.read": IO.ReadResponse;
    "IO.resolveBlob": IO.ResolveBlobResponse;
    "LayerTree.compositingReasons": LayerTree.CompositingReasonsResponse;
    "LayerTree.disable": LayerTree.DisableResponse;
    "LayerTree.enable": LayerTree.EnableResponse;
    "LayerTree.loadSnapshot": LayerTree.LoadSnapshotResponse;
    "LayerTree.makeSnapshot": LayerTree.MakeSnapshotResponse;
    "LayerTree.profileSnapshot": LayerTree.ProfileSnapshotResponse;
    "LayerTree.releaseSnapshot": LayerTree.ReleaseSnapshotResponse;
    "LayerTree.replaySnapshot": LayerTree.ReplaySnapshotResponse;
    "LayerTree.snapshotCommandLog": LayerTree.SnapshotCommandLogResponse;
    "Log.clear": Log.ClearResponse;
    "Log.disable": Log.DisableResponse;
    "Log.enable": Log.EnableResponse;
    "Log.startViolationsReport": Log.StartViolationsReportResponse;
    "Log.stopViolationsReport": Log.StopViolationsReportResponse;
    "Media.enable": Media.EnableResponse;
    "Media.disable": Media.DisableResponse;
    "Overlay.disable": Overlay.DisableResponse;
    "Overlay.enable": Overlay.EnableResponse;
    "Overlay.getHighlightObjectForTest": Overlay.GetHighlightObjectForTestResponse;
    "Overlay.getGridHighlightObjectsForTest": Overlay.GetGridHighlightObjectsForTestResponse;
    "Overlay.getSourceOrderHighlightObjectForTest": Overlay.GetSourceOrderHighlightObjectForTestResponse;
    "Overlay.hideHighlight": Overlay.HideHighlightResponse;
    "Overlay.highlightFrame": Overlay.HighlightFrameResponse;
    "Overlay.highlightNode": Overlay.HighlightNodeResponse;
    "Overlay.highlightQuad": Overlay.HighlightQuadResponse;
    "Overlay.highlightRect": Overlay.HighlightRectResponse;
    "Overlay.highlightSourceOrder": Overlay.HighlightSourceOrderResponse;
    "Overlay.setInspectMode": Overlay.SetInspectModeResponse;
    "Overlay.setShowAdHighlights": Overlay.SetShowAdHighlightsResponse;
    "Overlay.setPausedInDebuggerMessage": Overlay.SetPausedInDebuggerMessageResponse;
    "Overlay.setShowDebugBorders": Overlay.SetShowDebugBordersResponse;
    "Overlay.setShowFPSCounter": Overlay.SetShowFPSCounterResponse;
    "Overlay.setShowGridOverlays": Overlay.SetShowGridOverlaysResponse;
    "Overlay.setShowFlexOverlays": Overlay.SetShowFlexOverlaysResponse;
    "Overlay.setShowScrollSnapOverlays": Overlay.SetShowScrollSnapOverlaysResponse;
    "Overlay.setShowContainerQueryOverlays": Overlay.SetShowContainerQueryOverlaysResponse;
    "Overlay.setShowPaintRects": Overlay.SetShowPaintRectsResponse;
    "Overlay.setShowLayoutShiftRegions": Overlay.SetShowLayoutShiftRegionsResponse;
    "Overlay.setShowScrollBottleneckRects": Overlay.SetShowScrollBottleneckRectsResponse;
    "Overlay.setShowHitTestBorders": Overlay.SetShowHitTestBordersResponse;
    "Overlay.setShowWebVitals": Overlay.SetShowWebVitalsResponse;
    "Overlay.setShowViewportSizeOnResize": Overlay.SetShowViewportSizeOnResizeResponse;
    "Overlay.setShowHinge": Overlay.SetShowHingeResponse;
    "Overlay.setShowIsolatedElements": Overlay.SetShowIsolatedElementsResponse;
    "Overlay.setShowWindowControlsOverlay": Overlay.SetShowWindowControlsOverlayResponse;
    "Page.addScriptToEvaluateOnLoad": Page.AddScriptToEvaluateOnLoadResponse;
    "Page.addScriptToEvaluateOnNewDocument": Page.AddScriptToEvaluateOnNewDocumentResponse;
    "Page.bringToFront": Page.BringToFrontResponse;
    "Page.captureScreenshot": Page.CaptureScreenshotResponse;
    "Page.captureSnapshot": Page.CaptureSnapshotResponse;
    "Page.clearDeviceMetricsOverride": Page.ClearDeviceMetricsOverrideResponse;
    "Page.clearDeviceOrientationOverride": Page.ClearDeviceOrientationOverrideResponse;
    "Page.clearGeolocationOverride": Page.ClearGeolocationOverrideResponse;
    "Page.createIsolatedWorld": Page.CreateIsolatedWorldResponse;
    "Page.deleteCookie": Page.DeleteCookieResponse;
    "Page.disable": Page.DisableResponse;
    "Page.enable": Page.EnableResponse;
    "Page.getAppManifest": Page.GetAppManifestResponse;
    "Page.getInstallabilityErrors": Page.GetInstallabilityErrorsResponse;
    "Page.getManifestIcons": Page.GetManifestIconsResponse;
    "Page.getAppId": Page.GetAppIdResponse;
    "Page.getAdScriptId": Page.GetAdScriptIdResponse;
    "Page.getFrameTree": Page.GetFrameTreeResponse;
    "Page.getLayoutMetrics": Page.GetLayoutMetricsResponse;
    "Page.getNavigationHistory": Page.GetNavigationHistoryResponse;
    "Page.resetNavigationHistory": Page.ResetNavigationHistoryResponse;
    "Page.getResourceContent": Page.GetResourceContentResponse;
    "Page.getResourceTree": Page.GetResourceTreeResponse;
    "Page.handleJavaScriptDialog": Page.HandleJavaScriptDialogResponse;
    "Page.navigate": Page.NavigateResponse;
    "Page.navigateToHistoryEntry": Page.NavigateToHistoryEntryResponse;
    "Page.printToPDF": Page.PrintToPDFResponse;
    "Page.reload": Page.ReloadResponse;
    "Page.removeScriptToEvaluateOnLoad": Page.RemoveScriptToEvaluateOnLoadResponse;
    "Page.removeScriptToEvaluateOnNewDocument": Page.RemoveScriptToEvaluateOnNewDocumentResponse;
    "Page.screencastFrameAck": Page.ScreencastFrameAckResponse;
    "Page.searchInResource": Page.SearchInResourceResponse;
    "Page.setAdBlockingEnabled": Page.SetAdBlockingEnabledResponse;
    "Page.setBypassCSP": Page.SetBypassCSPResponse;
    "Page.getPermissionsPolicyState": Page.GetPermissionsPolicyStateResponse;
    "Page.getOriginTrials": Page.GetOriginTrialsResponse;
    "Page.setDeviceMetricsOverride": Page.SetDeviceMetricsOverrideResponse;
    "Page.setDeviceOrientationOverride": Page.SetDeviceOrientationOverrideResponse;
    "Page.setFontFamilies": Page.SetFontFamiliesResponse;
    "Page.setFontSizes": Page.SetFontSizesResponse;
    "Page.setDocumentContent": Page.SetDocumentContentResponse;
    "Page.setDownloadBehavior": Page.SetDownloadBehaviorResponse;
    "Page.setGeolocationOverride": Page.SetGeolocationOverrideResponse;
    "Page.setLifecycleEventsEnabled": Page.SetLifecycleEventsEnabledResponse;
    "Page.setTouchEmulationEnabled": Page.SetTouchEmulationEnabledResponse;
    "Page.startScreencast": Page.StartScreencastResponse;
    "Page.stopLoading": Page.StopLoadingResponse;
    "Page.crash": Page.CrashResponse;
    "Page.close": Page.CloseResponse;
    "Page.setWebLifecycleState": Page.SetWebLifecycleStateResponse;
    "Page.stopScreencast": Page.StopScreencastResponse;
    "Page.produceCompilationCache": Page.ProduceCompilationCacheResponse;
    "Page.addCompilationCache": Page.AddCompilationCacheResponse;
    "Page.clearCompilationCache": Page.ClearCompilationCacheResponse;
    "Page.setSPCTransactionMode": Page.SetSPCTransactionModeResponse;
    "Page.setRPHRegistrationMode": Page.SetRPHRegistrationModeResponse;
    "Page.generateTestReport": Page.GenerateTestReportResponse;
    "Page.waitForDebugger": Page.WaitForDebuggerResponse;
    "Page.setInterceptFileChooserDialog": Page.SetInterceptFileChooserDialogResponse;
    "Page.setPrerenderingAllowed": Page.SetPrerenderingAllowedResponse;
    "Performance.disable": Performance.DisableResponse;
    "Performance.enable": Performance.EnableResponse;
    "Performance.setTimeDomain": Performance.SetTimeDomainResponse;
    "Performance.getMetrics": Performance.GetMetricsResponse;
    "PerformanceTimeline.enable": PerformanceTimeline.EnableResponse;
    "Preload.enable": Preload.EnableResponse;
    "Preload.disable": Preload.DisableResponse;
    "Schema.getDomains": Schema.GetDomainsResponse;
    "Security.disable": Security.DisableResponse;
    "Security.enable": Security.EnableResponse;
    "Security.setIgnoreCertificateErrors": Security.SetIgnoreCertificateErrorsResponse;
    "Security.handleCertificateError": Security.HandleCertificateErrorResponse;
    "Security.setOverrideCertificateErrors": Security.SetOverrideCertificateErrorsResponse;
    "ServiceWorker.deliverPushMessage": ServiceWorker.DeliverPushMessageResponse;
    "ServiceWorker.disable": ServiceWorker.DisableResponse;
    "ServiceWorker.dispatchSyncEvent": ServiceWorker.DispatchSyncEventResponse;
    "ServiceWorker.dispatchPeriodicSyncEvent": ServiceWorker.DispatchPeriodicSyncEventResponse;
    "ServiceWorker.enable": ServiceWorker.EnableResponse;
    "ServiceWorker.inspectWorker": ServiceWorker.InspectWorkerResponse;
    "ServiceWorker.setForceUpdateOnPageLoad": ServiceWorker.SetForceUpdateOnPageLoadResponse;
    "ServiceWorker.skipWaiting": ServiceWorker.SkipWaitingResponse;
    "ServiceWorker.startWorker": ServiceWorker.StartWorkerResponse;
    "ServiceWorker.stopAllWorkers": ServiceWorker.StopAllWorkersResponse;
    "ServiceWorker.stopWorker": ServiceWorker.StopWorkerResponse;
    "ServiceWorker.unregister": ServiceWorker.UnregisterResponse;
    "ServiceWorker.updateRegistration": ServiceWorker.UpdateRegistrationResponse;
    "Storage.getStorageKeyForFrame": Storage.GetStorageKeyForFrameResponse;
    "Storage.clearDataForOrigin": Storage.ClearDataForOriginResponse;
    "Storage.clearDataForStorageKey": Storage.ClearDataForStorageKeyResponse;
    "Storage.getCookies": Storage.GetCookiesResponse;
    "Storage.setCookies": Storage.SetCookiesResponse;
    "Storage.clearCookies": Storage.ClearCookiesResponse;
    "Storage.getUsageAndQuota": Storage.GetUsageAndQuotaResponse;
    "Storage.overrideQuotaForOrigin": Storage.OverrideQuotaForOriginResponse;
    "Storage.trackCacheStorageForOrigin": Storage.TrackCacheStorageForOriginResponse;
    "Storage.trackCacheStorageForStorageKey": Storage.TrackCacheStorageForStorageKeyResponse;
    "Storage.trackIndexedDBForOrigin": Storage.TrackIndexedDBForOriginResponse;
    "Storage.trackIndexedDBForStorageKey": Storage.TrackIndexedDBForStorageKeyResponse;
    "Storage.untrackCacheStorageForOrigin": Storage.UntrackCacheStorageForOriginResponse;
    "Storage.untrackCacheStorageForStorageKey": Storage.UntrackCacheStorageForStorageKeyResponse;
    "Storage.untrackIndexedDBForOrigin": Storage.UntrackIndexedDBForOriginResponse;
    "Storage.untrackIndexedDBForStorageKey": Storage.UntrackIndexedDBForStorageKeyResponse;
    "Storage.getTrustTokens": Storage.GetTrustTokensResponse;
    "Storage.clearTrustTokens": Storage.ClearTrustTokensResponse;
    "Storage.getInterestGroupDetails": Storage.GetInterestGroupDetailsResponse;
    "Storage.setInterestGroupTracking": Storage.SetInterestGroupTrackingResponse;
    "Storage.getSharedStorageMetadata": Storage.GetSharedStorageMetadataResponse;
    "Storage.getSharedStorageEntries": Storage.GetSharedStorageEntriesResponse;
    "Storage.setSharedStorageEntry": Storage.SetSharedStorageEntryResponse;
    "Storage.deleteSharedStorageEntry": Storage.DeleteSharedStorageEntryResponse;
    "Storage.clearSharedStorageEntries": Storage.ClearSharedStorageEntriesResponse;
    "Storage.resetSharedStorageBudget": Storage.ResetSharedStorageBudgetResponse;
    "Storage.setSharedStorageTracking": Storage.SetSharedStorageTrackingResponse;
    "Storage.setStorageBucketTracking": Storage.SetStorageBucketTrackingResponse;
    "Storage.deleteStorageBucket": Storage.DeleteStorageBucketResponse;
    "Storage.runBounceTrackingMitigations": Storage.RunBounceTrackingMitigationsResponse;
    "Storage.setAttributionReportingLocalTestingMode": Storage.SetAttributionReportingLocalTestingModeResponse;
    "Storage.setAttributionReportingTracking": Storage.SetAttributionReportingTrackingResponse;
    "SystemInfo.getInfo": SystemInfo.GetInfoResponse;
    "SystemInfo.getFeatureState": SystemInfo.GetFeatureStateResponse;
    "SystemInfo.getProcessInfo": SystemInfo.GetProcessInfoResponse;
    "Target.activateTarget": Target.ActivateTargetResponse;
    "Target.attachToTarget": Target.AttachToTargetResponse;
    "Target.attachToBrowserTarget": Target.AttachToBrowserTargetResponse;
    "Target.closeTarget": Target.CloseTargetResponse;
    "Target.exposeDevToolsProtocol": Target.ExposeDevToolsProtocolResponse;
    "Target.createBrowserContext": Target.CreateBrowserContextResponse;
    "Target.getBrowserContexts": Target.GetBrowserContextsResponse;
    "Target.createTarget": Target.CreateTargetResponse;
    "Target.detachFromTarget": Target.DetachFromTargetResponse;
    "Target.disposeBrowserContext": Target.DisposeBrowserContextResponse;
    "Target.getTargetInfo": Target.GetTargetInfoResponse;
    "Target.getTargets": Target.GetTargetsResponse;
    "Target.sendMessageToTarget": Target.SendMessageToTargetResponse;
    "Target.setAutoAttach": Target.SetAutoAttachResponse;
    "Target.autoAttachRelated": Target.AutoAttachRelatedResponse;
    "Target.setDiscoverTargets": Target.SetDiscoverTargetsResponse;
    "Target.setRemoteLocations": Target.SetRemoteLocationsResponse;
    "Tethering.bind": Tethering.BindResponse;
    "Tethering.unbind": Tethering.UnbindResponse;
    "Tracing.end": Tracing.EndResponse;
    "Tracing.getCategories": Tracing.GetCategoriesResponse;
    "Tracing.recordClockSyncMarker": Tracing.RecordClockSyncMarkerResponse;
    "Tracing.requestMemoryDump": Tracing.RequestMemoryDumpResponse;
    "Tracing.start": Tracing.StartResponse;
    "WebAudio.enable": WebAudio.EnableResponse;
    "WebAudio.disable": WebAudio.DisableResponse;
    "WebAudio.getRealtimeData": WebAudio.GetRealtimeDataResponse;
    "WebAuthn.enable": WebAuthn.EnableResponse;
    "WebAuthn.disable": WebAuthn.DisableResponse;
    "WebAuthn.addVirtualAuthenticator": WebAuthn.AddVirtualAuthenticatorResponse;
    "WebAuthn.setResponseOverrideBits": WebAuthn.SetResponseOverrideBitsResponse;
    "WebAuthn.removeVirtualAuthenticator": WebAuthn.RemoveVirtualAuthenticatorResponse;
    "WebAuthn.addCredential": WebAuthn.AddCredentialResponse;
    "WebAuthn.getCredential": WebAuthn.GetCredentialResponse;
    "WebAuthn.getCredentials": WebAuthn.GetCredentialsResponse;
    "WebAuthn.removeCredential": WebAuthn.RemoveCredentialResponse;
    "WebAuthn.clearCredentials": WebAuthn.ClearCredentialsResponse;
    "WebAuthn.setUserVerified": WebAuthn.SetUserVerifiedResponse;
    "WebAuthn.setAutomaticPresenceSimulation": WebAuthn.SetAutomaticPresenceSimulationResponse;
  };

  export type Event<T extends keyof EventMap = keyof EventMap> = {
    readonly method: T;
    readonly params: EventMap[T];
  };

  export type Request<T extends keyof RequestMap = keyof RequestMap> = {
    readonly id: number;
    readonly method: T;
    readonly params: RequestMap[T];
  };

  export type Response<T extends keyof ResponseMap = keyof ResponseMap> = {
    readonly id: number;
  } & (
    | {
        readonly method?: T;
        readonly result: ResponseMap[T];
      }
    | {
        readonly error: {
          readonly code?: string;
          readonly message: string;
        };
      }
  );
}
