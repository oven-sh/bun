/*
 * Copyright (C) 2005-2024 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Jon Shier (jshier@iastate.edu)
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#pragma once

#include <array>
#include <functional>
#include <wtf/HashSet.h>
#include <wtf/OptionSet.h>
#include <wtf/RobinHoodHashMap.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/AtomStringHash.h>

namespace WebCore {

enum class EventType : uint16_t {
    custom = 0,
    DOMActivate,
    DOMCharacterDataModified,
    DOMContentLoaded,
    DOMNodeInserted,
    DOMNodeInsertedIntoDocument,
    DOMNodeRemoved,
    DOMNodeRemovedFromDocument,
    DOMSubtreeModified,
    abort,
    activate,
    active,
    addsourcebuffer,
    addstream,
    addtrack,
    afterprint,
    animationcancel,
    animationend,
    animationiteration,
    animationstart,
    audioend,
    audioprocess,
    audiostart,
    autocomplete,
    autocompleteerror,
    auxclick,
    backgroundfetchabort,
    backgroundfetchclick,
    backgroundfetchfail,
    backgroundfetchsuccess,
    beforecopy,
    beforecut,
    beforeinput,
    beforeload,
    beforematch,
    beforepaste,
    beforeprint,
    beforetoggle,
    beforeunload,
    begin,
    beginEvent,
    blocked,
    blur,
    boundary,
    bufferedamountlow,
    bufferedchange,
    cached,
    cancel,
    canplay,
    canplaythrough,
    change,
    chargingchange,
    chargingtimechange,
    checking,
    click,
    close,
    closing,
    command,
    complete,
    compositionend,
    compositionstart,
    compositionupdate,
    configurationchange,
    connect,
    connecting,
    connectionstatechange,
    contentvisibilityautostatechange,
    contextmenu,
    controllerchange,
    cookiechange,
    coordinatorstatechange,
    copy,
#if ENABLE(APPLE_PAY_COUPON_CODE)
    couponcodechanged,
#endif
    cuechange,
    currententrychange,
    cut,
    dataavailable,
    datachannel,
    dblclick,
    dequeue,
    devicechange,
    devicemotion,
    deviceorientation,
    dischargingtimechange,
    disconnect,
    dispose,
    downloading,
    drag,
    dragend,
    dragenter,
    dragleave,
    dragover,
    dragstart,
    drop,
    durationchange,
    emptied,
    encrypted,
    end,
    endEvent,
    ended,
    endstreaming,
    enter,
    enterpictureinpicture,
    error,
    exit,
    fetch,
    finish,
    focus,
    focusin,
    focusout,
    formdata,
    fullscreenchange,
    fullscreenerror,
    gamepadconnected,
    gamepaddisconnected,
    gatheringstatechange,
    gesturechange,
    gestureend,
    gesturescrollend,
    gesturescrollstart,
    gesturescrollupdate,
    gesturestart,
    gesturetap,
    gesturetapdown,
    gotpointercapture,
    hashchange,
    icecandidate,
    icecandidateerror,
    iceconnectionstatechange,
    icegatheringstatechange,
    immersivechange,
    immersiveerror,
    inactive,
    input,
    inputsourceschange,
    install,
    invalid,
    keydown,
    keypress,
    keystatuseschange,
    keyup,
    languagechange,
    leavepictureinpicture,
    levelchange,
    load,
    loadeddata,
    loadedmetadata,
    loadend,
    loading,
    loadingdone,
    loadingerror,
    loadstart,
    lostpointercapture,
    mark,
    merchantvalidation,
    message,
    messageerror,
    mousedown,
    mouseenter,
    mouseleave,
    mousemove,
    mouseout,
    mouseover,
    mouseup,
    mousewheel,
    mute,
    navigate,
    navigateerror,
    navigatesuccess,
    negotiationneeded,
    nexttrack,
    nomatch,
    notificationclick,
    notificationclose,
    noupdate,
    obsolete,
    offline,
    online,
    open,
    orientationchange,
    pagehide,
    pagereveal,
    pageshow,
    pageswap,
    paint,
    paste,
    pause,
    payerdetailchange,
    paymentauthorized,
    paymentmethodchange,
    paymentmethodselected,
    play,
    playing,
    pointercancel,
    pointerdown,
    pointerenter,
    pointerleave,
    pointerlockchange,
    pointerlockerror,
    pointermove,
    pointerout,
    pointerover,
    pointerup,
    popstate,
    previoustrack,
    processorerror,
    progress,
    push,
    pushsubscriptionchange,
    qualitychange,
    ratechange,
    readystatechange,
    redraw,
    rejectionhandled,
    release,
    remove,
    removesourcebuffer,
    removestream,
    removetrack,
    repeat,
    repeatEvent,
    reset,
    resize,
    resourcetimingbufferfull,
    result,
    resume,
    rtctransform,
    scroll,
    scrollend,
    securitypolicyviolation,
    seeked,
    seeking,
    select,
    selectedcandidatepairchange,
    selectend,
    selectionchange,
    selectstart,
    shippingaddresschange,
    shippingcontactselected,
    shippingmethodselected,
    shippingoptionchange,
    show,
    signalingstatechange,
    slotchange,
    soundend,
    soundstart,
    sourceclose,
    sourceended,
    sourceopen,
    speechend,
    speechstart,
    squeeze,
    squeezeend,
    squeezestart,
    stalled,
    start,
    started,
    startstreaming,
    statechange,
    stop,
    storage,
    submit,
    success,
    suspend,
    textInput,
    timeout,
    timeupdate,
    toggle,
    tonechange,
    touchcancel,
    touchend,
    touchforcechange,
    touchmove,
    touchstart,
    track,
    transitioncancel,
    transitionend,
    transitionrun,
    transitionstart,
    uncapturederror,
    unhandledrejection,
    unload,
    unmute,
    update,
    updateend,
    updatefound,
    updateready,
    updatestart,
    upgradeneeded,
    validatemerchant,
    versionchange,
    visibilitychange,
    voiceschanged,
    volumechange,
    waiting,
    waitingforkey,
    webglcontextcreationerror,
    webglcontextlost,
    webglcontextrestored,
    webkitAnimationEnd,
    webkitAnimationIteration,
    webkitAnimationStart,
    webkitBeforeTextInserted,
    webkitTransitionEnd,
    webkitassociateformcontrols,
    webkitautofillrequest,
    webkitbeforeblur,
    webkitbeforefocus,
    webkitbeginfullscreen,
    webkitcameramoved,
    webkitcameraviewchanged,
    webkitcurrentplaybacktargetiswirelesschanged,
    webkitendfullscreen,
    webkitexternalplaybackchanged,
    webkitfocusedelementdisconnected,
    webkitfullscreenchange,
    webkitfullscreenerror,
    webkitkeyadded,
    webkitkeyerror,
    webkitkeymessage,
    webkitmediasessionmetadatachanged,
    webkitmouseforcechanged,
    webkitmouseforcedown,
    webkitmouseforceup,
    webkitmouseforcewillbegin,
    webkitneedkey,
    webkitnetworkinfochange,
    webkitplaybacktargetavailabilitychanged,
    webkitpresentationmodechanged,
    webkitprojectionchanged,
    webkitremovesourcebuffer,
    webkitsourceclose,
    webkitsourceended,
    webkitsourceopen,
    webkitsubmit,
    webkitusertextinput,
    wheel,
    write,
    writeend,
    writestart,
    zoom,
};

enum class EventCategory : uint16_t {
    CSSAnimation = 1u << 0,
    CSSTransition = 1u << 1,
    EventTimingEligible = 1u << 2,
    ExtendedTouchRelated = 1u << 3,
    Gamepad = 1u << 4,
    Gesture = 1u << 5,
    MouseClickRelated = 1u << 6,
    MouseMoveRelated = 1u << 7,
    SimulatedMouse = 1u << 8,
    TouchRelated = 1u << 9,
    TouchScrollBlocking = 1u << 10,
    Wheel = 1u << 11,
};

class EventTypeInfo {
public:
    enum class DefaultEventHandler : bool { No,
        Yes };

    constexpr EventTypeInfo()
        : m_type(EventType::custom)
    {
    }

    constexpr EventTypeInfo(EventType type, OptionSet<EventCategory> categories, DefaultEventHandler defaultEventHandler)
        : m_type(type)
        , m_categories(categories.toRaw())
        , m_hasDefaultEventHandler(defaultEventHandler == DefaultEventHandler::Yes)
    {
    }

    EventType type() const { return static_cast<EventType>(m_type); }
    bool isInCategory(EventCategory category) const { return OptionSet<EventCategory>::fromRaw(m_categories).contains(category); }
    bool hasDefaultEventHandler() const { return m_hasDefaultEventHandler; }

private:
    EventType m_type;
    uint16_t m_categories : 15 { 0 };
    uint16_t m_hasDefaultEventHandler : 1 { false };
};

struct EventNames {
    WTF_MAKE_NONCOPYABLE(EventNames);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(EventNames);

public:
    const AtomString DOMActivateEvent;
    const AtomString DOMCharacterDataModifiedEvent;
    const AtomString DOMContentLoadedEvent;
    const AtomString DOMNodeInsertedEvent;
    const AtomString DOMNodeInsertedIntoDocumentEvent;
    const AtomString DOMNodeRemovedEvent;
    const AtomString DOMNodeRemovedFromDocumentEvent;
    const AtomString DOMSubtreeModifiedEvent;
    const AtomString abortEvent;
    const AtomString activateEvent;
    const AtomString activeEvent;
    const AtomString addsourcebufferEvent;
    const AtomString addstreamEvent;
    const AtomString addtrackEvent;
    const AtomString afterprintEvent;
    const AtomString animationcancelEvent;
    const AtomString animationendEvent;
    const AtomString animationiterationEvent;
    const AtomString animationstartEvent;
    const AtomString audioendEvent;
    const AtomString audioprocessEvent;
    const AtomString audiostartEvent;
    const AtomString autocompleteEvent;
    const AtomString autocompleteerrorEvent;
    const AtomString auxclickEvent;
    const AtomString backgroundfetchabortEvent;
    const AtomString backgroundfetchclickEvent;
    const AtomString backgroundfetchfailEvent;
    const AtomString backgroundfetchsuccessEvent;
    const AtomString beforecopyEvent;
    const AtomString beforecutEvent;
    const AtomString beforeinputEvent;
    const AtomString beforeloadEvent;
    const AtomString beforematchEvent;
    const AtomString beforepasteEvent;
    const AtomString beforeprintEvent;
    const AtomString beforetoggleEvent;
    const AtomString beforeunloadEvent;
    const AtomString beginEvent;
    const AtomString beginEventEvent;
    const AtomString blockedEvent;
    const AtomString blurEvent;
    const AtomString boundaryEvent;
    const AtomString bufferedamountlowEvent;
    const AtomString bufferedchangeEvent;
    const AtomString cachedEvent;
    const AtomString cancelEvent;
    const AtomString canplayEvent;
    const AtomString canplaythroughEvent;
    const AtomString changeEvent;
    const AtomString chargingchangeEvent;
    const AtomString chargingtimechangeEvent;
    const AtomString checkingEvent;
    const AtomString clickEvent;
    const AtomString closeEvent;
    const AtomString closingEvent;
    const AtomString commandEvent;
    const AtomString completeEvent;
    const AtomString compositionendEvent;
    const AtomString compositionstartEvent;
    const AtomString compositionupdateEvent;
    const AtomString configurationchangeEvent;
    const AtomString connectEvent;
    const AtomString connectingEvent;
    const AtomString connectionstatechangeEvent;
    const AtomString contentvisibilityautostatechangeEvent;
    const AtomString contextmenuEvent;
    const AtomString controllerchangeEvent;
    const AtomString cookiechangeEvent;
    const AtomString coordinatorstatechangeEvent;
    const AtomString copyEvent;
#if ENABLE(APPLE_PAY_COUPON_CODE)
    const AtomString couponcodechangedEvent;
#endif
    const AtomString cuechangeEvent;
    const AtomString currententrychangeEvent;
    const AtomString cutEvent;
    const AtomString dataavailableEvent;
    const AtomString datachannelEvent;
    const AtomString dblclickEvent;
    const AtomString dequeueEvent;
    const AtomString devicechangeEvent;
    const AtomString devicemotionEvent;
    const AtomString deviceorientationEvent;
    const AtomString dischargingtimechangeEvent;
    const AtomString disconnectEvent;
    const AtomString disposeEvent;
    const AtomString downloadingEvent;
    const AtomString dragEvent;
    const AtomString dragendEvent;
    const AtomString dragenterEvent;
    const AtomString dragleaveEvent;
    const AtomString dragoverEvent;
    const AtomString dragstartEvent;
    const AtomString dropEvent;
    const AtomString durationchangeEvent;
    const AtomString emptiedEvent;
    const AtomString encryptedEvent;
    const AtomString endEvent;
    const AtomString endEventEvent;
    const AtomString endedEvent;
    const AtomString endstreamingEvent;
    const AtomString enterEvent;
    const AtomString enterpictureinpictureEvent;
    const AtomString errorEvent;
    const AtomString exitEvent;
    const AtomString fetchEvent;
    const AtomString finishEvent;
    const AtomString focusEvent;
    const AtomString focusinEvent;
    const AtomString focusoutEvent;
    const AtomString formdataEvent;
    const AtomString fullscreenchangeEvent;
    const AtomString fullscreenerrorEvent;
    const AtomString gamepadconnectedEvent;
    const AtomString gamepaddisconnectedEvent;
    const AtomString gatheringstatechangeEvent;
    const AtomString gesturechangeEvent;
    const AtomString gestureendEvent;
    const AtomString gesturescrollendEvent;
    const AtomString gesturescrollstartEvent;
    const AtomString gesturescrollupdateEvent;
    const AtomString gesturestartEvent;
    const AtomString gesturetapEvent;
    const AtomString gesturetapdownEvent;
    const AtomString gotpointercaptureEvent;
    const AtomString hashchangeEvent;
    const AtomString icecandidateEvent;
    const AtomString icecandidateerrorEvent;
    const AtomString iceconnectionstatechangeEvent;
    const AtomString icegatheringstatechangeEvent;
    const AtomString immersivechangeEvent;
    const AtomString immersiveerrorEvent;
    const AtomString inactiveEvent;
    const AtomString inputEvent;
    const AtomString inputsourceschangeEvent;
    const AtomString installEvent;
    const AtomString invalidEvent;
    const AtomString keydownEvent;
    const AtomString keypressEvent;
    const AtomString keystatuseschangeEvent;
    const AtomString keyupEvent;
    const AtomString languagechangeEvent;
    const AtomString leavepictureinpictureEvent;
    const AtomString levelchangeEvent;
    const AtomString loadEvent;
    const AtomString loadeddataEvent;
    const AtomString loadedmetadataEvent;
    const AtomString loadendEvent;
    const AtomString loadingEvent;
    const AtomString loadingdoneEvent;
    const AtomString loadingerrorEvent;
    const AtomString loadstartEvent;
    const AtomString lostpointercaptureEvent;
    const AtomString markEvent;
    const AtomString merchantvalidationEvent;
    const AtomString messageEvent;
    const AtomString messageerrorEvent;
    const AtomString mousedownEvent;
    const AtomString mouseenterEvent;
    const AtomString mouseleaveEvent;
    const AtomString mousemoveEvent;
    const AtomString mouseoutEvent;
    const AtomString mouseoverEvent;
    const AtomString mouseupEvent;
    const AtomString mousewheelEvent;
    const AtomString muteEvent;
    const AtomString navigateEvent;
    const AtomString navigateerrorEvent;
    const AtomString navigatesuccessEvent;
    const AtomString negotiationneededEvent;
    const AtomString nexttrackEvent;
    const AtomString nomatchEvent;
    const AtomString notificationclickEvent;
    const AtomString notificationcloseEvent;
    const AtomString noupdateEvent;
    const AtomString obsoleteEvent;
    const AtomString offlineEvent;
    const AtomString onlineEvent;
    const AtomString openEvent;
    const AtomString orientationchangeEvent;
    const AtomString pagehideEvent;
    const AtomString pagerevealEvent;
    const AtomString pageshowEvent;
    const AtomString pageswapEvent;
    const AtomString paintEvent;
    const AtomString pasteEvent;
    const AtomString pauseEvent;
    const AtomString payerdetailchangeEvent;
    const AtomString paymentauthorizedEvent;
    const AtomString paymentmethodchangeEvent;
    const AtomString paymentmethodselectedEvent;
    const AtomString playEvent;
    const AtomString playingEvent;
    const AtomString pointercancelEvent;
    const AtomString pointerdownEvent;
    const AtomString pointerenterEvent;
    const AtomString pointerleaveEvent;
    const AtomString pointerlockchangeEvent;
    const AtomString pointerlockerrorEvent;
    const AtomString pointermoveEvent;
    const AtomString pointeroutEvent;
    const AtomString pointeroverEvent;
    const AtomString pointerupEvent;
    const AtomString popstateEvent;
    const AtomString previoustrackEvent;
    const AtomString processorerrorEvent;
    const AtomString progressEvent;
    const AtomString pushEvent;
    const AtomString pushsubscriptionchangeEvent;
    const AtomString qualitychangeEvent;
    const AtomString ratechangeEvent;
    const AtomString readystatechangeEvent;
    const AtomString redrawEvent;
    const AtomString rejectionhandledEvent;
    const AtomString releaseEvent;
    const AtomString removeEvent;
    const AtomString removesourcebufferEvent;
    const AtomString removestreamEvent;
    const AtomString removetrackEvent;
    const AtomString repeatEvent;
    const AtomString repeatEventEvent;
    const AtomString resetEvent;
    const AtomString resizeEvent;
    const AtomString resourcetimingbufferfullEvent;
    const AtomString resultEvent;
    const AtomString resumeEvent;
    const AtomString rtctransformEvent;
    const AtomString scrollEvent;
    const AtomString scrollendEvent;
    const AtomString securitypolicyviolationEvent;
    const AtomString seekedEvent;
    const AtomString seekingEvent;
    const AtomString selectEvent;
    const AtomString selectedcandidatepairchangeEvent;
    const AtomString selectendEvent;
    const AtomString selectionchangeEvent;
    const AtomString selectstartEvent;
    const AtomString shippingaddresschangeEvent;
    const AtomString shippingcontactselectedEvent;
    const AtomString shippingmethodselectedEvent;
    const AtomString shippingoptionchangeEvent;
    const AtomString showEvent;
    const AtomString signalingstatechangeEvent;
    const AtomString slotchangeEvent;
    const AtomString soundendEvent;
    const AtomString soundstartEvent;
    const AtomString sourcecloseEvent;
    const AtomString sourceendedEvent;
    const AtomString sourceopenEvent;
    const AtomString speechendEvent;
    const AtomString speechstartEvent;
    const AtomString squeezeEvent;
    const AtomString squeezeendEvent;
    const AtomString squeezestartEvent;
    const AtomString stalledEvent;
    const AtomString startEvent;
    const AtomString startedEvent;
    const AtomString startstreamingEvent;
    const AtomString statechangeEvent;
    const AtomString stopEvent;
    const AtomString storageEvent;
    const AtomString submitEvent;
    const AtomString successEvent;
    const AtomString suspendEvent;
    const AtomString textInputEvent;
    const AtomString timeoutEvent;
    const AtomString timeupdateEvent;
    const AtomString toggleEvent;
    const AtomString tonechangeEvent;
    const AtomString touchcancelEvent;
    const AtomString touchendEvent;
    const AtomString touchforcechangeEvent;
    const AtomString touchmoveEvent;
    const AtomString touchstartEvent;
    const AtomString trackEvent;
    const AtomString transitioncancelEvent;
    const AtomString transitionendEvent;
    const AtomString transitionrunEvent;
    const AtomString transitionstartEvent;
    const AtomString uncapturederrorEvent;
    const AtomString unhandledrejectionEvent;
    const AtomString unloadEvent;
    const AtomString unmuteEvent;
    const AtomString updateEvent;
    const AtomString updateendEvent;
    const AtomString updatefoundEvent;
    const AtomString updatereadyEvent;
    const AtomString updatestartEvent;
    const AtomString upgradeneededEvent;
    const AtomString validatemerchantEvent;
    const AtomString versionchangeEvent;
    const AtomString visibilitychangeEvent;
    const AtomString voiceschangedEvent;
    const AtomString volumechangeEvent;
    const AtomString waitingEvent;
    const AtomString waitingforkeyEvent;
    const AtomString webglcontextcreationerrorEvent;
    const AtomString webglcontextlostEvent;
    const AtomString webglcontextrestoredEvent;
    const AtomString webkitAnimationEndEvent;
    const AtomString webkitAnimationIterationEvent;
    const AtomString webkitAnimationStartEvent;
    const AtomString webkitBeforeTextInsertedEvent;
    const AtomString webkitTransitionEndEvent;
    const AtomString webkitassociateformcontrolsEvent;
    const AtomString webkitautofillrequestEvent;
    const AtomString webkitbeforeblurEvent;
    const AtomString webkitbeforefocusEvent;
    const AtomString webkitbeginfullscreenEvent;
    const AtomString webkitcameramovedEvent;
    const AtomString webkitcameraviewchangedEvent;
    const AtomString webkitcurrentplaybacktargetiswirelesschangedEvent;
    const AtomString webkitendfullscreenEvent;
    const AtomString webkitexternalplaybackchangedEvent;
    const AtomString webkitfocusedelementdisconnectedEvent;
    const AtomString webkitfullscreenchangeEvent;
    const AtomString webkitfullscreenerrorEvent;
    const AtomString webkitkeyaddedEvent;
    const AtomString webkitkeyerrorEvent;
    const AtomString webkitkeymessageEvent;
    const AtomString webkitmediasessionmetadatachangedEvent;
    const AtomString webkitmouseforcechangedEvent;
    const AtomString webkitmouseforcedownEvent;
    const AtomString webkitmouseforceupEvent;
    const AtomString webkitmouseforcewillbeginEvent;
    const AtomString webkitneedkeyEvent;
    const AtomString webkitnetworkinfochangeEvent;
    const AtomString webkitplaybacktargetavailabilitychangedEvent;
    const AtomString webkitpresentationmodechangedEvent;
    const AtomString webkitprojectionchangedEvent;
    const AtomString webkitremovesourcebufferEvent;
    const AtomString webkitsourcecloseEvent;
    const AtomString webkitsourceendedEvent;
    const AtomString webkitsourceopenEvent;
    const AtomString webkitsubmitEvent;
    const AtomString webkitusertextinputEvent;
    const AtomString wheelEvent;
    const AtomString writeEvent;
    const AtomString writeendEvent;
    const AtomString writestartEvent;
    const AtomString zoomEvent;

    // Bun's own. They have no EventType.
    const AtomString handshakeEvent;
    const AtomString renameEvent;

    EventTypeInfo typeInfoForEvent(const AtomString&) const;

    ~EventNames();

    template<class... Args>
    static std::unique_ptr<EventNames> create(Args&&... args)
    {
        return std::unique_ptr<EventNames>(new EventNames(std::forward<Args>(args)...));
    }

    std::array<const AtomString, 340> allEventNames() const;
    WTF::HashSet<AtomString> allEventHandlerNames() const;

    static constexpr std::array timedEvents {
        EventType::auxclick,
        EventType::beforeinput,
        EventType::click,
        EventType::compositionend,
        EventType::compositionstart,
        EventType::compositionupdate,
        EventType::contextmenu,
        EventType::dblclick,
        EventType::dragend,
        EventType::dragenter,
        EventType::dragleave,
        EventType::dragover,
        EventType::dragstart,
        EventType::drop,
        EventType::gotpointercapture,
        EventType::input,
        EventType::keydown,
        EventType::keypress,
        EventType::keyup,
        EventType::lostpointercapture,
        EventType::mousedown,
        EventType::mouseenter,
        EventType::mouseleave,
        EventType::mouseout,
        EventType::mouseover,
        EventType::mouseup,
        EventType::pointercancel,
        EventType::pointerdown,
        EventType::pointerenter,
        EventType::pointerleave,
        EventType::pointerout,
        EventType::pointerover,
        EventType::pointerup,
        EventType::touchcancel,
        EventType::touchend,
        EventType::touchstart,
    };

    const AtomString& eventNameFromEventType(EventType) const;

private:
    EventNames();

    MemoryCompactLookupOnlyRobinHoodHashMap<AtomString, EventTypeInfo> m_typeInfoMap;
};

const EventNames& eventNames();

inline EventTypeInfo EventNames::typeInfoForEvent(const AtomString& eventType) const
{
    return m_typeInfoMap.inlineGet(eventType);
}

} // namespace WebCore
