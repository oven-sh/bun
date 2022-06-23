/*
 * Copyright (C) 2005, 2007, 2015 Apple Inc. All rights reserved.
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

// #include "ThreadGlobalData.h"
#include "EventTarget.h"
#include <array>
#include <functional>
#include <wtf/text/AtomString.h>

namespace WebCore {

#define DOM_EVENT_NAMES_FOR_EACH(macro) \
    macro(error)                        \
        macro(abort)                    \
            macro(close)                \
                macro(open)             \
                    macro(message)      \
                        macro(messageerror)

// macro(DOMActivate) \
    // macro(DOMCharacterDataModified) \
    // macro(DOMContentLoaded) \
    // macro(DOMNodeInserted) \
    // macro(DOMNodeInsertedIntoDocument) \
    // macro(DOMNodeRemoved) \
    // macro(DOMNodeRemovedFromDocument) \
    // macro(DOMSubtreeModified) \
    // macro(abort) \
    // macro(activate) \
    // macro(active) \
    // macro(addsourcebuffer) \
    // macro(addstream) \
    // macro(addtrack) \
    // macro(afterprint) \
    // macro(animationcancel) \
    // macro(animationend) \
    // macro(animationiteration) \
    // macro(animationstart) \
    // macro(audioend) \
    // macro(audioprocess) \
    // macro(audiostart) \
    // macro(autocomplete) \
    // macro(autocompleteerror) \
    // macro(beforecopy) \
    // macro(beforecut) \
    // macro(beforeinput) \
    // macro(beforeload) \
    // macro(beforepaste) \
    // macro(beforeprint) \
    // macro(beforeunload) \
    // macro(beginEvent) \
    // macro(blocked) \
    // macro(blur) \
    // macro(boundary) \
    // macro(bufferedamountlow) \
    // macro(cached) \
    // macro(cancel) \
    // macro(canplay) \
    // macro(canplaythrough) \
    // macro(change) \
    // macro(chargingchange) \
    // macro(chargingtimechange) \
    // macro(checking) \
    // macro(click) \
    // macro(close) \
    // macro(closing) \
    // macro(complete) \
    // macro(compositionend) \
    // macro(compositionstart) \
    // macro(compositionupdate) \
    // macro(connect) \
    // macro(connectionstatechange) \
    // macro(connecting) \
    // macro(contextmenu) \
    // macro(controllerchange) \
    // macro(coordinatorstatechange) \
    // macro(copy) \
    // macro(cuechange) \
    // macro(cut) \
    // macro(dataavailable) \
    // macro(datachannel) \
    // macro(dblclick) \
    // macro(devicechange) \
    // macro(devicemotion) \
    // macro(deviceorientation) \
    // macro(dischargingtimechange) \
    // macro(disconnect) \
    // macro(downloading) \
    // macro(drag) \
    // macro(dragend) \
    // macro(dragenter) \
    // macro(dragleave) \
    // macro(dragover) \
    // macro(dragstart) \
    // macro(drop) \
    // macro(durationchange) \
    // macro(emptied) \
    // macro(encrypted) \
    // macro(end) \
    // macro(endEvent) \
    // macro(ended) \
    // macro(enter) \
    // macro(enterpictureinpicture) \
    // macro(error) \
    // macro(exit) \
    // macro(fetch) \
    // macro(finish) \
    // macro(focus) \
    // macro(focusin) \
    // macro(focusout) \
    // macro(formdata) \
    // macro(gamepadconnected) \
    // macro(gamepaddisconnected) \
    // macro(gatheringstatechange) \
    // macro(gesturechange) \
    // macro(gestureend) \
    // macro(gesturescrollend) \
    // macro(gesturescrollstart) \
    // macro(gesturescrollupdate) \
    // macro(gesturestart) \
    // macro(gesturetap) \
    // macro(gesturetapdown) \
    // macro(gotpointercapture) \
    // macro(hashchange) \
    // macro(icecandidate) \
    // macro(icecandidateerror) \
    // macro(iceconnectionstatechange) \
    // macro(icegatheringstatechange) \
    // macro(inactive) \
    // macro(input) \
    // macro(inputsourceschange) \
    // macro(install) \
    // macro(invalid) \
    // macro(keydown) \
    // macro(keypress) \
    // macro(keystatuseschange) \
    // macro(keyup) \
    // macro(languagechange) \
    // macro(leavepictureinpicture) \
    // macro(levelchange) \
    // macro(load) \
    // macro(loadeddata) \
    // macro(loadedmetadata) \
    // macro(loadend) \
    // macro(loading) \
    // macro(loadingdone) \
    // macro(loadingerror) \
    // macro(loadstart) \
    // macro(lostpointercapture) \
    // macro(mark) \
    // macro(merchantvalidation) \
    // macro(message) \
    // macro(messageerror) \
    // macro(mousedown) \
    // macro(mouseenter) \
    // macro(mouseleave) \
    // macro(mousemove) \
    // macro(mouseout) \
    // macro(mouseover) \
    // macro(mouseup) \
    // macro(mousewheel) \
    // macro(mute) \
    // macro(negotiationneeded) \
    // macro(nexttrack) \
    // macro(nomatch) \
    // macro(notificationclick) \
    // macro(notificationclose) \
    // macro(noupdate) \
    // macro(obsolete) \
    // macro(offline) \
    // macro(online) \
    // macro(orientationchange) \
    // macro(overflowchanged) \
    // macro(pagehide) \
    // macro(pageshow) \
    // macro(paste) \
    // macro(pause) \
    // macro(payerdetailchange) \
    // macro(paymentauthorized) \
    // macro(paymentmethodchange) \
    // macro(paymentmethodselected) \
    // macro(play) \
    // macro(playing) \
    // macro(pointerlockchange) \
    // macro(pointerlockerror) \
    // macro(pointercancel) \
    // macro(pointerdown) \
    // macro(pointerenter) \
    // macro(pointerleave) \
    // macro(pointermove) \
    // macro(pointerout) \
    // macro(pointerover) \
    // macro(pointerup) \
    // macro(popstate) \
    // macro(previoustrack) \
    // macro(processorerror) \
    // macro(progress) \
    // macro(push) \
    // macro(pushsubscriptionchange) \
    // macro(ratechange) \
    // macro(readystatechange) \
    // macro(rejectionhandled) \
    // macro(remove) \
    // macro(removesourcebuffer) \
    // macro(removestream) \
    // macro(removetrack) \
    // macro(reset) \
    // macro(resize) \
    // macro(resourcetimingbufferfull) \
    // macro(result) \
    // macro(resume) \
    // macro(rtctransform) \
    // macro(scroll) \
    // macro(search) \
    // macro(securitypolicyviolation) \
    // macro(seeked) \
    // macro(seeking) \
    // macro(select) \
    // macro(selectend) \
    // macro(selectionchange) \
    // macro(selectstart) \
    // macro(shippingaddresschange) \
    // macro(shippingcontactselected) \
    // macro(shippingmethodselected) \
    // macro(shippingoptionchange) \
    // macro(show) \
    // macro(signalingstatechange) \
    // macro(slotchange) \
    // macro(soundend) \
    // macro(soundstart) \
    // macro(sourceclose) \
    // macro(sourceended) \
    // macro(sourceopen) \
    // macro(speechend) \
    // macro(speechstart) \
    // macro(squeeze) \
    // macro(squeezestart) \
    // macro(squeezeend) \
    // macro(stalled) \
    // macro(start) \
    // macro(started) \
    // macro(statechange) \
    // macro(stop) \
    // macro(storage) \
    // macro(submit) \
    // macro(success) \
    // macro(suspend) \
    // macro(textInput) \
    // macro(timeout) \
    // macro(timeupdate) \
    // macro(toggle) \
    // macro(tonechange) \
    // macro(touchcancel) \
    // macro(touchend) \
    // macro(touchforcechange) \
    // macro(touchmove) \
    // macro(touchstart) \
    // macro(track) \
    // macro(transitioncancel) \
    // macro(transitionend) \
    // macro(transitionrun) \
    // macro(transitionstart) \
    // macro(uncapturederror) \
    // macro(unhandledrejection) \
    // macro(unload) \
    // macro(unmute) \
    // macro(update) \
    // macro(updateend) \
    // macro(updatefound) \
    // macro(updateready) \
    // macro(updatestart) \
    // macro(upgradeneeded) \
    // macro(validatemerchant) \
    // macro(versionchange) \
    // macro(visibilitychange) \
    // macro(voiceschanged) \
    // macro(volumechange) \
    // macro(waiting) \
    // macro(waitingforkey) \
    // macro(webglcontextchanged) \
    // macro(webglcontextcreationerror) \
    // macro(webglcontextlost) \
    // macro(webglcontextrestored) \
    // macro(webkitAnimationEnd) \
    // macro(webkitAnimationIteration) \
    // macro(webkitAnimationStart) \
    // macro(webkitBeforeTextInserted) \
    // macro(webkitTransitionEnd) \
    // macro(webkitbeginfullscreen) \
    // macro(webkitcurrentplaybacktargetiswirelesschanged) \
    // macro(webkitendfullscreen) \
    // macro(webkitfullscreenchange) \
    // macro(webkitfullscreenerror) \
    // macro(webkitkeyadded) \
    // macro(webkitkeyerror) \
    // macro(webkitkeymessage) \
    // macro(webkitmouseforcechanged) \
    // macro(webkitmouseforcedown) \
    // macro(webkitmouseforcewillbegin) \
    // macro(webkitmouseforceup) \
    // macro(webkitneedkey) \
    // macro(webkitnetworkinfochange) \
    // macro(webkitplaybacktargetavailabilitychanged) \
    // macro(webkitpresentationmodechanged) \
    // macro(webkitremovesourcebuffer) \
    // macro(webkitsourceclose) \
    // macro(webkitsourceended) \
    // macro(webkitsourceopen) \
    macro(wheel) \
    macro(write) \
    macro(writeend) \
    macro(writestart) \
    macro(zoom) \
// end of DOM_EVENT_NAMES_FOR_EACH

struct EventNames {
    WTF_MAKE_NONCOPYABLE(EventNames);
    WTF_MAKE_FAST_ALLOCATED;

public:
#define DOM_EVENT_NAMES_DECLARE(name) const AtomString name##Event;
    DOM_EVENT_NAMES_FOR_EACH(DOM_EVENT_NAMES_DECLARE)
#undef DOM_EVENT_NAMES_DECLARE

    // FIXME: The friend declaration to makeUnique below does not work in windows port.
    //
    // template<class T, class... Args>
    // friend typename std::_Unique_if<T>::_Single_object makeUnique(Args&&...);
    //
    // This create function should be deleted later and is only for keeping EventNames as private.
    // makeUnique should be used instead.
    //
    template<class... Args>
    static std::unique_ptr<EventNames> create(Args&&... args)
    {
        return std::unique_ptr<EventNames>(new EventNames(std::forward<Args>(args)...));
    }

    // FIXME: Inelegant to call these both event names and event types.
    // We should choose one term and stick to it.
    bool isWheelEventType(const AtomString& eventType) const;
    bool isGestureEventType(const AtomString& eventType) const;
    bool isTouchRelatedEventType(const AtomString& eventType, EventTarget&) const;
    bool isTouchScrollBlockingEventType(const AtomString& eventType) const;
#if ENABLE(GAMEPAD)
    bool isGamepadEventType(const AtomString& eventType) const;
#endif

    std::array<std::reference_wrapper<const AtomString>, 0> touchRelatedEventNames() const;
    std::array<std::reference_wrapper<const AtomString>, 0> extendedTouchRelatedEventNames() const;
    std::array<std::reference_wrapper<const AtomString>, 0> gestureEventNames() const;

private:
    EventNames(); // Private to prevent accidental call to EventNames() instead of eventNames().
    // friend class ThreadGlobalData; // Allow ThreadGlobalData to create the per-thread EventNames object.

    int dummy; // Needed to make initialization macro work.
};

const EventNames& eventNames();

inline bool EventNames::isGestureEventType(const AtomString& eventType) const
{
    return false; // eventType == gesturestartEvent || eventType == gesturechangeEvent || eventType == gestureendEvent;
}

inline bool EventNames::isTouchScrollBlockingEventType(const AtomString& eventType) const
{
    return false;
}

inline bool EventNames::isTouchRelatedEventType(const AtomString& eventType, EventTarget& target) const
{
    return false;
}

inline bool EventNames::isWheelEventType(const AtomString& eventType) const
{
    return false;
}

inline std::array<std::reference_wrapper<const AtomString>, 0> EventNames::touchRelatedEventNames() const
{
    return { {} };
}

inline std::array<std::reference_wrapper<const AtomString>, 0> EventNames::extendedTouchRelatedEventNames() const
{
    return { {} };
}

inline std::array<std::reference_wrapper<const AtomString>, 0> EventNames::gestureEventNames() const
{
    return { {} };
}

// inline std::array<std::reference_wrapper<const AtomString>, 13> EventNames::touchRelatedEventNames() const
// {
//     return { { touchstartEvent, touchmoveEvent, touchendEvent, touchcancelEvent, touchforcechangeEvent, pointeroverEvent, pointerenterEvent, pointerdownEvent, pointermoveEvent, pointerupEvent, pointeroutEvent, pointerleaveEvent, pointercancelEvent } };
// }

// inline std::array<std::reference_wrapper<const AtomString>, 16> EventNames::extendedTouchRelatedEventNames() const
// {
//     return { { touchstartEvent, touchmoveEvent, touchendEvent, touchcancelEvent, touchforcechangeEvent, pointeroverEvent, pointerenterEvent, pointerdownEvent, pointermoveEvent, pointerupEvent, pointeroutEvent, pointerleaveEvent, pointercancelEvent, mousedownEvent, mousemoveEvent, mouseupEvent } };
// }

// inline std::array<std::reference_wrapper<const AtomString>, 3> EventNames::gestureEventNames() const
// {
//     return { { gesturestartEvent, gesturechangeEvent, gestureendEvent } };
// }

} // namespace WebCore
