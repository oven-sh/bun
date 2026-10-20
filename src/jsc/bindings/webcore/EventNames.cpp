/*
 * Copyright (C) 2005-2024 Apple Inc. All rights reserved.
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

#include "config.h"
#include "EventNames.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSStringInlines.h>

namespace WebCore {

static constexpr StringImpl::StaticStringImpl DOMActivateData("DOMActivate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl DOMCharacterDataModifiedData("DOMCharacterDataModified", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl DOMContentLoadedData("DOMContentLoaded", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl DOMNodeInsertedData("DOMNodeInserted", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl DOMNodeInsertedIntoDocumentData("DOMNodeInsertedIntoDocument", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl DOMNodeRemovedData("DOMNodeRemoved", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl DOMNodeRemovedFromDocumentData("DOMNodeRemovedFromDocument", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl DOMSubtreeModifiedData("DOMSubtreeModified", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl abortData("abort", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl activateData("activate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl activeData("active", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl addsourcebufferData("addsourcebuffer", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl addstreamData("addstream", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl addtrackData("addtrack", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl afterprintData("afterprint", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl animationcancelData("animationcancel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl animationendData("animationend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl animationiterationData("animationiteration", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl animationstartData("animationstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl audioendData("audioend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl audioprocessData("audioprocess", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl audiostartData("audiostart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl autocompleteData("autocomplete", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl autocompleteerrorData("autocompleteerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl auxclickData("auxclick", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl backgroundfetchabortData("backgroundfetchabort", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl backgroundfetchclickData("backgroundfetchclick", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl backgroundfetchfailData("backgroundfetchfail", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl backgroundfetchsuccessData("backgroundfetchsuccess", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforecopyData("beforecopy", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforecutData("beforecut", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforeinputData("beforeinput", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforeloadData("beforeload", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforematchData("beforematch", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforepasteData("beforepaste", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforeprintData("beforeprint", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforetoggleData("beforetoggle", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beforeunloadData("beforeunload", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beginData("begin", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl beginEventData("beginEvent", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl blockedData("blocked", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl blurData("blur", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl boundaryData("boundary", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl bufferedamountlowData("bufferedamountlow", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl bufferedchangeData("bufferedchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl cachedData("cached", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl cancelData("cancel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl canplayData("canplay", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl canplaythroughData("canplaythrough", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl changeData("change", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl chargingchangeData("chargingchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl chargingtimechangeData("chargingtimechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl checkingData("checking", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl clickData("click", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl closeData("close", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl closingData("closing", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl commandData("command", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl completeData("complete", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl compositionendData("compositionend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl compositionstartData("compositionstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl compositionupdateData("compositionupdate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl configurationchangeData("configurationchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl connectData("connect", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl connectingData("connecting", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl connectionstatechangeData("connectionstatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl contentvisibilityautostatechangeData("contentvisibilityautostatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl contextmenuData("contextmenu", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl controllerchangeData("controllerchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl cookiechangeData("cookiechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl coordinatorstatechangeData("coordinatorstatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl copyData("copy", StringImpl::StringAtom);
#if ENABLE(APPLE_PAY_COUPON_CODE)
static constexpr StringImpl::StaticStringImpl couponcodechangedData("couponcodechanged", StringImpl::StringAtom);
#endif
static constexpr StringImpl::StaticStringImpl cuechangeData("cuechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl currententrychangeData("currententrychange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl cutData("cut", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dataavailableData("dataavailable", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl datachannelData("datachannel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dblclickData("dblclick", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dequeueData("dequeue", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl devicechangeData("devicechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl devicemotionData("devicemotion", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl deviceorientationData("deviceorientation", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dischargingtimechangeData("dischargingtimechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl disconnectData("disconnect", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl disposeData("dispose", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl downloadingData("downloading", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dragData("drag", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dragendData("dragend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dragenterData("dragenter", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dragleaveData("dragleave", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dragoverData("dragover", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dragstartData("dragstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl dropData("drop", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl durationchangeData("durationchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl emptiedData("emptied", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl encryptedData("encrypted", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl endData("end", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl endEventData("endEvent", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl endedData("ended", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl endstreamingData("endstreaming", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl enterData("enter", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl enterpictureinpictureData("enterpictureinpicture", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl errorData("error", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl exitData("exit", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl fetchData("fetch", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl finishData("finish", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl focusData("focus", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl focusinData("focusin", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl focusoutData("focusout", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl formdataData("formdata", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl fullscreenchangeData("fullscreenchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl fullscreenerrorData("fullscreenerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gamepadconnectedData("gamepadconnected", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gamepaddisconnectedData("gamepaddisconnected", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gatheringstatechangeData("gatheringstatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gesturechangeData("gesturechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gestureendData("gestureend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gesturescrollendData("gesturescrollend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gesturescrollstartData("gesturescrollstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gesturescrollupdateData("gesturescrollupdate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gesturestartData("gesturestart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gesturetapData("gesturetap", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gesturetapdownData("gesturetapdown", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl gotpointercaptureData("gotpointercapture", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl hashchangeData("hashchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl icecandidateData("icecandidate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl icecandidateerrorData("icecandidateerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl iceconnectionstatechangeData("iceconnectionstatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl icegatheringstatechangeData("icegatheringstatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl immersivechangeData("immersivechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl immersiveerrorData("immersiveerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl inactiveData("inactive", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl inputData("input", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl inputsourceschangeData("inputsourceschange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl installData("install", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl invalidData("invalid", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl keydownData("keydown", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl keypressData("keypress", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl keystatuseschangeData("keystatuseschange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl keyupData("keyup", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl languagechangeData("languagechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl leavepictureinpictureData("leavepictureinpicture", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl levelchangeData("levelchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadData("load", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadeddataData("loadeddata", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadedmetadataData("loadedmetadata", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadendData("loadend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadingData("loading", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadingdoneData("loadingdone", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadingerrorData("loadingerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl loadstartData("loadstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl lostpointercaptureData("lostpointercapture", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl markData("mark", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl merchantvalidationData("merchantvalidation", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl messageData("message", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl messageerrorData("messageerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mousedownData("mousedown", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mouseenterData("mouseenter", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mouseleaveData("mouseleave", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mousemoveData("mousemove", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mouseoutData("mouseout", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mouseoverData("mouseover", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mouseupData("mouseup", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl mousewheelData("mousewheel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl muteData("mute", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl navigateData("navigate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl navigateerrorData("navigateerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl navigatesuccessData("navigatesuccess", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl negotiationneededData("negotiationneeded", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl nexttrackData("nexttrack", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl nomatchData("nomatch", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl notificationclickData("notificationclick", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl notificationcloseData("notificationclose", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl noupdateData("noupdate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl obsoleteData("obsolete", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl offlineData("offline", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl onlineData("online", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl openData("open", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl orientationchangeData("orientationchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pagehideData("pagehide", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pagerevealData("pagereveal", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pageshowData("pageshow", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pageswapData("pageswap", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl paintData("paint", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pasteData("paste", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pauseData("pause", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl payerdetailchangeData("payerdetailchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl paymentauthorizedData("paymentauthorized", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl paymentmethodchangeData("paymentmethodchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl paymentmethodselectedData("paymentmethodselected", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl playData("play", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl playingData("playing", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointercancelData("pointercancel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointerdownData("pointerdown", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointerenterData("pointerenter", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointerleaveData("pointerleave", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointerlockchangeData("pointerlockchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointerlockerrorData("pointerlockerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointermoveData("pointermove", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointeroutData("pointerout", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointeroverData("pointerover", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pointerupData("pointerup", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl popstateData("popstate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl previoustrackData("previoustrack", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl processorerrorData("processorerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl progressData("progress", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pushData("push", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl pushsubscriptionchangeData("pushsubscriptionchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl qualitychangeData("qualitychange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl ratechangeData("ratechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl readystatechangeData("readystatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl redrawData("redraw", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl rejectionhandledData("rejectionhandled", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl releaseData("release", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl removeData("remove", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl removesourcebufferData("removesourcebuffer", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl removestreamData("removestream", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl removetrackData("removetrack", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl repeatData("repeat", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl repeatEventData("repeatEvent", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl resetData("reset", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl resizeData("resize", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl resourcetimingbufferfullData("resourcetimingbufferfull", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl resultData("result", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl resumeData("resume", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl rtctransformData("rtctransform", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl scrollData("scroll", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl scrollendData("scrollend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl securitypolicyviolationData("securitypolicyviolation", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl seekedData("seeked", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl seekingData("seeking", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl selectData("select", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl selectedcandidatepairchangeData("selectedcandidatepairchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl selectendData("selectend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl selectionchangeData("selectionchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl selectstartData("selectstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl shippingaddresschangeData("shippingaddresschange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl shippingcontactselectedData("shippingcontactselected", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl shippingmethodselectedData("shippingmethodselected", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl shippingoptionchangeData("shippingoptionchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl showData("show", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl signalingstatechangeData("signalingstatechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl slotchangeData("slotchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl soundendData("soundend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl soundstartData("soundstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl sourcecloseData("sourceclose", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl sourceendedData("sourceended", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl sourceopenData("sourceopen", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl speechendData("speechend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl speechstartData("speechstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl squeezeData("squeeze", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl squeezeendData("squeezeend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl squeezestartData("squeezestart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl stalledData("stalled", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl startData("start", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl startedData("started", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl startstreamingData("startstreaming", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl statechangeData("statechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl stopData("stop", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl storageData("storage", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl submitData("submit", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl successData("success", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl suspendData("suspend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl textInputData("textInput", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl timeoutData("timeout", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl timeupdateData("timeupdate", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl toggleData("toggle", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl tonechangeData("tonechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl touchcancelData("touchcancel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl touchendData("touchend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl touchforcechangeData("touchforcechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl touchmoveData("touchmove", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl touchstartData("touchstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl trackData("track", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl transitioncancelData("transitioncancel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl transitionendData("transitionend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl transitionrunData("transitionrun", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl transitionstartData("transitionstart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl uncapturederrorData("uncapturederror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl unhandledrejectionData("unhandledrejection", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl unloadData("unload", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl unmuteData("unmute", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl updateData("update", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl updateendData("updateend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl updatefoundData("updatefound", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl updatereadyData("updateready", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl updatestartData("updatestart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl upgradeneededData("upgradeneeded", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl validatemerchantData("validatemerchant", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl versionchangeData("versionchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl visibilitychangeData("visibilitychange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl voiceschangedData("voiceschanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl volumechangeData("volumechange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl waitingData("waiting", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl waitingforkeyData("waitingforkey", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webglcontextcreationerrorData("webglcontextcreationerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webglcontextlostData("webglcontextlost", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webglcontextrestoredData("webglcontextrestored", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitAnimationEndData("webkitAnimationEnd", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitAnimationIterationData("webkitAnimationIteration", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitAnimationStartData("webkitAnimationStart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitBeforeTextInsertedData("webkitBeforeTextInserted", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitTransitionEndData("webkitTransitionEnd", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitassociateformcontrolsData("webkitassociateformcontrols", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitautofillrequestData("webkitautofillrequest", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitbeforeblurData("webkitbeforeblur", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitbeforefocusData("webkitbeforefocus", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitbeginfullscreenData("webkitbeginfullscreen", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitcameramovedData("webkitcameramoved", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitcameraviewchangedData("webkitcameraviewchanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitcurrentplaybacktargetiswirelesschangedData("webkitcurrentplaybacktargetiswirelesschanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitendfullscreenData("webkitendfullscreen", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitexternalplaybackchangedData("webkitexternalplaybackchanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitfocusedelementdisconnectedData("webkitfocusedelementdisconnected", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitfullscreenchangeData("webkitfullscreenchange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitfullscreenerrorData("webkitfullscreenerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitkeyaddedData("webkitkeyadded", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitkeyerrorData("webkitkeyerror", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitkeymessageData("webkitkeymessage", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitmediasessionmetadatachangedData("webkitmediasessionmetadatachanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitmouseforcechangedData("webkitmouseforcechanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitmouseforcedownData("webkitmouseforcedown", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitmouseforceupData("webkitmouseforceup", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitmouseforcewillbeginData("webkitmouseforcewillbegin", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitneedkeyData("webkitneedkey", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitnetworkinfochangeData("webkitnetworkinfochange", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitplaybacktargetavailabilitychangedData("webkitplaybacktargetavailabilitychanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitpresentationmodechangedData("webkitpresentationmodechanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitprojectionchangedData("webkitprojectionchanged", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitremovesourcebufferData("webkitremovesourcebuffer", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitsourcecloseData("webkitsourceclose", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitsourceendedData("webkitsourceended", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitsourceopenData("webkitsourceopen", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitsubmitData("webkitsubmit", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl webkitusertextinputData("webkitusertextinput", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl wheelData("wheel", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl writeData("write", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl writeendData("writeend", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl writestartData("writestart", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl zoomData("zoom", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl handshakeData("handshake", StringImpl::StringAtom);
static constexpr StringImpl::StaticStringImpl renameData("rename", StringImpl::StringAtom);

// 340 members are made and destroyed once for each VM. Inlined, that is 63 KB of straight-line code.
__attribute__((minsize)) EventNames::EventNames()
    : DOMActivateEvent(DOMActivateData)
    , DOMCharacterDataModifiedEvent(DOMCharacterDataModifiedData)
    , DOMContentLoadedEvent(DOMContentLoadedData)
    , DOMNodeInsertedEvent(DOMNodeInsertedData)
    , DOMNodeInsertedIntoDocumentEvent(DOMNodeInsertedIntoDocumentData)
    , DOMNodeRemovedEvent(DOMNodeRemovedData)
    , DOMNodeRemovedFromDocumentEvent(DOMNodeRemovedFromDocumentData)
    , DOMSubtreeModifiedEvent(DOMSubtreeModifiedData)
    , abortEvent(abortData)
    , activateEvent(activateData)
    , activeEvent(activeData)
    , addsourcebufferEvent(addsourcebufferData)
    , addstreamEvent(addstreamData)
    , addtrackEvent(addtrackData)
    , afterprintEvent(afterprintData)
    , animationcancelEvent(animationcancelData)
    , animationendEvent(animationendData)
    , animationiterationEvent(animationiterationData)
    , animationstartEvent(animationstartData)
    , audioendEvent(audioendData)
    , audioprocessEvent(audioprocessData)
    , audiostartEvent(audiostartData)
    , autocompleteEvent(autocompleteData)
    , autocompleteerrorEvent(autocompleteerrorData)
    , auxclickEvent(auxclickData)
    , backgroundfetchabortEvent(backgroundfetchabortData)
    , backgroundfetchclickEvent(backgroundfetchclickData)
    , backgroundfetchfailEvent(backgroundfetchfailData)
    , backgroundfetchsuccessEvent(backgroundfetchsuccessData)
    , beforecopyEvent(beforecopyData)
    , beforecutEvent(beforecutData)
    , beforeinputEvent(beforeinputData)
    , beforeloadEvent(beforeloadData)
    , beforematchEvent(beforematchData)
    , beforepasteEvent(beforepasteData)
    , beforeprintEvent(beforeprintData)
    , beforetoggleEvent(beforetoggleData)
    , beforeunloadEvent(beforeunloadData)
    , beginEvent(beginData)
    , beginEventEvent(beginEventData)
    , blockedEvent(blockedData)
    , blurEvent(blurData)
    , boundaryEvent(boundaryData)
    , bufferedamountlowEvent(bufferedamountlowData)
    , bufferedchangeEvent(bufferedchangeData)
    , cachedEvent(cachedData)
    , cancelEvent(cancelData)
    , canplayEvent(canplayData)
    , canplaythroughEvent(canplaythroughData)
    , changeEvent(changeData)
    , chargingchangeEvent(chargingchangeData)
    , chargingtimechangeEvent(chargingtimechangeData)
    , checkingEvent(checkingData)
    , clickEvent(clickData)
    , closeEvent(closeData)
    , closingEvent(closingData)
    , commandEvent(commandData)
    , completeEvent(completeData)
    , compositionendEvent(compositionendData)
    , compositionstartEvent(compositionstartData)
    , compositionupdateEvent(compositionupdateData)
    , configurationchangeEvent(configurationchangeData)
    , connectEvent(connectData)
    , connectingEvent(connectingData)
    , connectionstatechangeEvent(connectionstatechangeData)
    , contentvisibilityautostatechangeEvent(contentvisibilityautostatechangeData)
    , contextmenuEvent(contextmenuData)
    , controllerchangeEvent(controllerchangeData)
    , cookiechangeEvent(cookiechangeData)
    , coordinatorstatechangeEvent(coordinatorstatechangeData)
    , copyEvent(copyData)
#if ENABLE(APPLE_PAY_COUPON_CODE)
    , couponcodechangedEvent(couponcodechangedData)
#endif
    , cuechangeEvent(cuechangeData)
    , currententrychangeEvent(currententrychangeData)
    , cutEvent(cutData)
    , dataavailableEvent(dataavailableData)
    , datachannelEvent(datachannelData)
    , dblclickEvent(dblclickData)
    , dequeueEvent(dequeueData)
    , devicechangeEvent(devicechangeData)
    , devicemotionEvent(devicemotionData)
    , deviceorientationEvent(deviceorientationData)
    , dischargingtimechangeEvent(dischargingtimechangeData)
    , disconnectEvent(disconnectData)
    , disposeEvent(disposeData)
    , downloadingEvent(downloadingData)
    , dragEvent(dragData)
    , dragendEvent(dragendData)
    , dragenterEvent(dragenterData)
    , dragleaveEvent(dragleaveData)
    , dragoverEvent(dragoverData)
    , dragstartEvent(dragstartData)
    , dropEvent(dropData)
    , durationchangeEvent(durationchangeData)
    , emptiedEvent(emptiedData)
    , encryptedEvent(encryptedData)
    , endEvent(endData)
    , endEventEvent(endEventData)
    , endedEvent(endedData)
    , endstreamingEvent(endstreamingData)
    , enterEvent(enterData)
    , enterpictureinpictureEvent(enterpictureinpictureData)
    , errorEvent(errorData)
    , exitEvent(exitData)
    , fetchEvent(fetchData)
    , finishEvent(finishData)
    , focusEvent(focusData)
    , focusinEvent(focusinData)
    , focusoutEvent(focusoutData)
    , formdataEvent(formdataData)
    , fullscreenchangeEvent(fullscreenchangeData)
    , fullscreenerrorEvent(fullscreenerrorData)
    , gamepadconnectedEvent(gamepadconnectedData)
    , gamepaddisconnectedEvent(gamepaddisconnectedData)
    , gatheringstatechangeEvent(gatheringstatechangeData)
    , gesturechangeEvent(gesturechangeData)
    , gestureendEvent(gestureendData)
    , gesturescrollendEvent(gesturescrollendData)
    , gesturescrollstartEvent(gesturescrollstartData)
    , gesturescrollupdateEvent(gesturescrollupdateData)
    , gesturestartEvent(gesturestartData)
    , gesturetapEvent(gesturetapData)
    , gesturetapdownEvent(gesturetapdownData)
    , gotpointercaptureEvent(gotpointercaptureData)
    , hashchangeEvent(hashchangeData)
    , icecandidateEvent(icecandidateData)
    , icecandidateerrorEvent(icecandidateerrorData)
    , iceconnectionstatechangeEvent(iceconnectionstatechangeData)
    , icegatheringstatechangeEvent(icegatheringstatechangeData)
    , immersivechangeEvent(immersivechangeData)
    , immersiveerrorEvent(immersiveerrorData)
    , inactiveEvent(inactiveData)
    , inputEvent(inputData)
    , inputsourceschangeEvent(inputsourceschangeData)
    , installEvent(installData)
    , invalidEvent(invalidData)
    , keydownEvent(keydownData)
    , keypressEvent(keypressData)
    , keystatuseschangeEvent(keystatuseschangeData)
    , keyupEvent(keyupData)
    , languagechangeEvent(languagechangeData)
    , leavepictureinpictureEvent(leavepictureinpictureData)
    , levelchangeEvent(levelchangeData)
    , loadEvent(loadData)
    , loadeddataEvent(loadeddataData)
    , loadedmetadataEvent(loadedmetadataData)
    , loadendEvent(loadendData)
    , loadingEvent(loadingData)
    , loadingdoneEvent(loadingdoneData)
    , loadingerrorEvent(loadingerrorData)
    , loadstartEvent(loadstartData)
    , lostpointercaptureEvent(lostpointercaptureData)
    , markEvent(markData)
    , merchantvalidationEvent(merchantvalidationData)
    , messageEvent(messageData)
    , messageerrorEvent(messageerrorData)
    , mousedownEvent(mousedownData)
    , mouseenterEvent(mouseenterData)
    , mouseleaveEvent(mouseleaveData)
    , mousemoveEvent(mousemoveData)
    , mouseoutEvent(mouseoutData)
    , mouseoverEvent(mouseoverData)
    , mouseupEvent(mouseupData)
    , mousewheelEvent(mousewheelData)
    , muteEvent(muteData)
    , navigateEvent(navigateData)
    , navigateerrorEvent(navigateerrorData)
    , navigatesuccessEvent(navigatesuccessData)
    , negotiationneededEvent(negotiationneededData)
    , nexttrackEvent(nexttrackData)
    , nomatchEvent(nomatchData)
    , notificationclickEvent(notificationclickData)
    , notificationcloseEvent(notificationcloseData)
    , noupdateEvent(noupdateData)
    , obsoleteEvent(obsoleteData)
    , offlineEvent(offlineData)
    , onlineEvent(onlineData)
    , openEvent(openData)
    , orientationchangeEvent(orientationchangeData)
    , pagehideEvent(pagehideData)
    , pagerevealEvent(pagerevealData)
    , pageshowEvent(pageshowData)
    , pageswapEvent(pageswapData)
    , paintEvent(paintData)
    , pasteEvent(pasteData)
    , pauseEvent(pauseData)
    , payerdetailchangeEvent(payerdetailchangeData)
    , paymentauthorizedEvent(paymentauthorizedData)
    , paymentmethodchangeEvent(paymentmethodchangeData)
    , paymentmethodselectedEvent(paymentmethodselectedData)
    , playEvent(playData)
    , playingEvent(playingData)
    , pointercancelEvent(pointercancelData)
    , pointerdownEvent(pointerdownData)
    , pointerenterEvent(pointerenterData)
    , pointerleaveEvent(pointerleaveData)
    , pointerlockchangeEvent(pointerlockchangeData)
    , pointerlockerrorEvent(pointerlockerrorData)
    , pointermoveEvent(pointermoveData)
    , pointeroutEvent(pointeroutData)
    , pointeroverEvent(pointeroverData)
    , pointerupEvent(pointerupData)
    , popstateEvent(popstateData)
    , previoustrackEvent(previoustrackData)
    , processorerrorEvent(processorerrorData)
    , progressEvent(progressData)
    , pushEvent(pushData)
    , pushsubscriptionchangeEvent(pushsubscriptionchangeData)
    , qualitychangeEvent(qualitychangeData)
    , ratechangeEvent(ratechangeData)
    , readystatechangeEvent(readystatechangeData)
    , redrawEvent(redrawData)
    , rejectionhandledEvent(rejectionhandledData)
    , releaseEvent(releaseData)
    , removeEvent(removeData)
    , removesourcebufferEvent(removesourcebufferData)
    , removestreamEvent(removestreamData)
    , removetrackEvent(removetrackData)
    , repeatEvent(repeatData)
    , repeatEventEvent(repeatEventData)
    , resetEvent(resetData)
    , resizeEvent(resizeData)
    , resourcetimingbufferfullEvent(resourcetimingbufferfullData)
    , resultEvent(resultData)
    , resumeEvent(resumeData)
    , rtctransformEvent(rtctransformData)
    , scrollEvent(scrollData)
    , scrollendEvent(scrollendData)
    , securitypolicyviolationEvent(securitypolicyviolationData)
    , seekedEvent(seekedData)
    , seekingEvent(seekingData)
    , selectEvent(selectData)
    , selectedcandidatepairchangeEvent(selectedcandidatepairchangeData)
    , selectendEvent(selectendData)
    , selectionchangeEvent(selectionchangeData)
    , selectstartEvent(selectstartData)
    , shippingaddresschangeEvent(shippingaddresschangeData)
    , shippingcontactselectedEvent(shippingcontactselectedData)
    , shippingmethodselectedEvent(shippingmethodselectedData)
    , shippingoptionchangeEvent(shippingoptionchangeData)
    , showEvent(showData)
    , signalingstatechangeEvent(signalingstatechangeData)
    , slotchangeEvent(slotchangeData)
    , soundendEvent(soundendData)
    , soundstartEvent(soundstartData)
    , sourcecloseEvent(sourcecloseData)
    , sourceendedEvent(sourceendedData)
    , sourceopenEvent(sourceopenData)
    , speechendEvent(speechendData)
    , speechstartEvent(speechstartData)
    , squeezeEvent(squeezeData)
    , squeezeendEvent(squeezeendData)
    , squeezestartEvent(squeezestartData)
    , stalledEvent(stalledData)
    , startEvent(startData)
    , startedEvent(startedData)
    , startstreamingEvent(startstreamingData)
    , statechangeEvent(statechangeData)
    , stopEvent(stopData)
    , storageEvent(storageData)
    , submitEvent(submitData)
    , successEvent(successData)
    , suspendEvent(suspendData)
    , textInputEvent(textInputData)
    , timeoutEvent(timeoutData)
    , timeupdateEvent(timeupdateData)
    , toggleEvent(toggleData)
    , tonechangeEvent(tonechangeData)
    , touchcancelEvent(touchcancelData)
    , touchendEvent(touchendData)
    , touchforcechangeEvent(touchforcechangeData)
    , touchmoveEvent(touchmoveData)
    , touchstartEvent(touchstartData)
    , trackEvent(trackData)
    , transitioncancelEvent(transitioncancelData)
    , transitionendEvent(transitionendData)
    , transitionrunEvent(transitionrunData)
    , transitionstartEvent(transitionstartData)
    , uncapturederrorEvent(uncapturederrorData)
    , unhandledrejectionEvent(unhandledrejectionData)
    , unloadEvent(unloadData)
    , unmuteEvent(unmuteData)
    , updateEvent(updateData)
    , updateendEvent(updateendData)
    , updatefoundEvent(updatefoundData)
    , updatereadyEvent(updatereadyData)
    , updatestartEvent(updatestartData)
    , upgradeneededEvent(upgradeneededData)
    , validatemerchantEvent(validatemerchantData)
    , versionchangeEvent(versionchangeData)
    , visibilitychangeEvent(visibilitychangeData)
    , voiceschangedEvent(voiceschangedData)
    , volumechangeEvent(volumechangeData)
    , waitingEvent(waitingData)
    , waitingforkeyEvent(waitingforkeyData)
    , webglcontextcreationerrorEvent(webglcontextcreationerrorData)
    , webglcontextlostEvent(webglcontextlostData)
    , webglcontextrestoredEvent(webglcontextrestoredData)
    , webkitAnimationEndEvent(webkitAnimationEndData)
    , webkitAnimationIterationEvent(webkitAnimationIterationData)
    , webkitAnimationStartEvent(webkitAnimationStartData)
    , webkitBeforeTextInsertedEvent(webkitBeforeTextInsertedData)
    , webkitTransitionEndEvent(webkitTransitionEndData)
    , webkitassociateformcontrolsEvent(webkitassociateformcontrolsData)
    , webkitautofillrequestEvent(webkitautofillrequestData)
    , webkitbeforeblurEvent(webkitbeforeblurData)
    , webkitbeforefocusEvent(webkitbeforefocusData)
    , webkitbeginfullscreenEvent(webkitbeginfullscreenData)
    , webkitcameramovedEvent(webkitcameramovedData)
    , webkitcameraviewchangedEvent(webkitcameraviewchangedData)
    , webkitcurrentplaybacktargetiswirelesschangedEvent(webkitcurrentplaybacktargetiswirelesschangedData)
    , webkitendfullscreenEvent(webkitendfullscreenData)
    , webkitexternalplaybackchangedEvent(webkitexternalplaybackchangedData)
    , webkitfocusedelementdisconnectedEvent(webkitfocusedelementdisconnectedData)
    , webkitfullscreenchangeEvent(webkitfullscreenchangeData)
    , webkitfullscreenerrorEvent(webkitfullscreenerrorData)
    , webkitkeyaddedEvent(webkitkeyaddedData)
    , webkitkeyerrorEvent(webkitkeyerrorData)
    , webkitkeymessageEvent(webkitkeymessageData)
    , webkitmediasessionmetadatachangedEvent(webkitmediasessionmetadatachangedData)
    , webkitmouseforcechangedEvent(webkitmouseforcechangedData)
    , webkitmouseforcedownEvent(webkitmouseforcedownData)
    , webkitmouseforceupEvent(webkitmouseforceupData)
    , webkitmouseforcewillbeginEvent(webkitmouseforcewillbeginData)
    , webkitneedkeyEvent(webkitneedkeyData)
    , webkitnetworkinfochangeEvent(webkitnetworkinfochangeData)
    , webkitplaybacktargetavailabilitychangedEvent(webkitplaybacktargetavailabilitychangedData)
    , webkitpresentationmodechangedEvent(webkitpresentationmodechangedData)
    , webkitprojectionchangedEvent(webkitprojectionchangedData)
    , webkitremovesourcebufferEvent(webkitremovesourcebufferData)
    , webkitsourcecloseEvent(webkitsourcecloseData)
    , webkitsourceendedEvent(webkitsourceendedData)
    , webkitsourceopenEvent(webkitsourceopenData)
    , webkitsubmitEvent(webkitsubmitData)
    , webkitusertextinputEvent(webkitusertextinputData)
    , wheelEvent(wheelData)
    , writeEvent(writeData)
    , writeendEvent(writeendData)
    , writestartEvent(writestartData)
    , zoomEvent(zoomData)
    , handshakeEvent(handshakeData)
    , renameEvent(renameData)
{
    struct TypeInfoEntry {
        const AtomString EventNames::* name;
        EventTypeInfo info;
    };
    static constexpr TypeInfoEntry typeInfoEntries[] = {
        { &EventNames::DOMActivateEvent, { EventType::DOMActivate, { EventCategory::MouseClickRelated }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::DOMCharacterDataModifiedEvent, { EventType::DOMCharacterDataModified, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::DOMContentLoadedEvent, { EventType::DOMContentLoaded, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::DOMNodeInsertedEvent, { EventType::DOMNodeInserted, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::DOMNodeInsertedIntoDocumentEvent, { EventType::DOMNodeInsertedIntoDocument, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::DOMNodeRemovedEvent, { EventType::DOMNodeRemoved, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::DOMNodeRemovedFromDocumentEvent, { EventType::DOMNodeRemovedFromDocument, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::DOMSubtreeModifiedEvent, { EventType::DOMSubtreeModified, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::abortEvent, { EventType::abort, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::activateEvent, { EventType::activate, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::activeEvent, { EventType::active, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::addsourcebufferEvent, { EventType::addsourcebuffer, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::addstreamEvent, { EventType::addstream, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::addtrackEvent, { EventType::addtrack, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::afterprintEvent, { EventType::afterprint, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::animationcancelEvent, { EventType::animationcancel, { EventCategory::CSSAnimation }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::animationendEvent, { EventType::animationend, { EventCategory::CSSAnimation }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::animationiterationEvent, { EventType::animationiteration, { EventCategory::CSSAnimation }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::animationstartEvent, { EventType::animationstart, { EventCategory::CSSAnimation }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::audioendEvent, { EventType::audioend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::audioprocessEvent, { EventType::audioprocess, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::audiostartEvent, { EventType::audiostart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::autocompleteEvent, { EventType::autocomplete, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::autocompleteerrorEvent, { EventType::autocompleteerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::auxclickEvent, { EventType::auxclick, { EventCategory::MouseClickRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::backgroundfetchabortEvent, { EventType::backgroundfetchabort, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::backgroundfetchclickEvent, { EventType::backgroundfetchclick, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::backgroundfetchfailEvent, { EventType::backgroundfetchfail, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::backgroundfetchsuccessEvent, { EventType::backgroundfetchsuccess, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforecopyEvent, { EventType::beforecopy, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforecutEvent, { EventType::beforecut, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforeinputEvent, { EventType::beforeinput, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforeloadEvent, { EventType::beforeload, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforematchEvent, { EventType::beforematch, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforepasteEvent, { EventType::beforepaste, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforeprintEvent, { EventType::beforeprint, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforetoggleEvent, { EventType::beforetoggle, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beforeunloadEvent, { EventType::beforeunload, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beginEvent, { EventType::begin, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::beginEventEvent, { EventType::beginEvent, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::blockedEvent, { EventType::blocked, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::blurEvent, { EventType::blur, {}, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::boundaryEvent, { EventType::boundary, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::bufferedamountlowEvent, { EventType::bufferedamountlow, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::bufferedchangeEvent, { EventType::bufferedchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::cachedEvent, { EventType::cached, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::cancelEvent, { EventType::cancel, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::canplayEvent, { EventType::canplay, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::canplaythroughEvent, { EventType::canplaythrough, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::changeEvent, { EventType::change, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::chargingchangeEvent, { EventType::chargingchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::chargingtimechangeEvent, { EventType::chargingtimechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::checkingEvent, { EventType::checking, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::clickEvent, { EventType::click, { EventCategory::MouseClickRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::closeEvent, { EventType::close, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::closingEvent, { EventType::closing, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::commandEvent, { EventType::command, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::completeEvent, { EventType::complete, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::compositionendEvent, { EventType::compositionend, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::compositionstartEvent, { EventType::compositionstart, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::compositionupdateEvent, { EventType::compositionupdate, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::configurationchangeEvent, { EventType::configurationchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::connectEvent, { EventType::connect, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::connectingEvent, { EventType::connecting, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::connectionstatechangeEvent, { EventType::connectionstatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::contentvisibilityautostatechangeEvent, { EventType::contentvisibilityautostatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::contextmenuEvent, { EventType::contextmenu, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::controllerchangeEvent, { EventType::controllerchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::cookiechangeEvent, { EventType::cookiechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::coordinatorstatechangeEvent, { EventType::coordinatorstatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::copyEvent, { EventType::copy, {}, EventTypeInfo::DefaultEventHandler::No } },
#if ENABLE(APPLE_PAY_COUPON_CODE)
        { &EventNames::couponcodechangedEvent, { EventType::couponcodechanged, {}, EventTypeInfo::DefaultEventHandler::No } },
#endif
        { &EventNames::cuechangeEvent, { EventType::cuechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::currententrychangeEvent, { EventType::currententrychange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::cutEvent, { EventType::cut, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dataavailableEvent, { EventType::dataavailable, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::datachannelEvent, { EventType::datachannel, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dblclickEvent, { EventType::dblclick, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::dequeueEvent, { EventType::dequeue, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::devicechangeEvent, { EventType::devicechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::devicemotionEvent, { EventType::devicemotion, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::deviceorientationEvent, { EventType::deviceorientation, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dischargingtimechangeEvent, { EventType::dischargingtimechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::disconnectEvent, { EventType::disconnect, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::disposeEvent, { EventType::dispose, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::downloadingEvent, { EventType::downloading, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dragEvent, { EventType::drag, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dragendEvent, { EventType::dragend, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dragenterEvent, { EventType::dragenter, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dragleaveEvent, { EventType::dragleave, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dragoverEvent, { EventType::dragover, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dragstartEvent, { EventType::dragstart, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::dropEvent, { EventType::drop, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::durationchangeEvent, { EventType::durationchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::emptiedEvent, { EventType::emptied, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::encryptedEvent, { EventType::encrypted, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::endEvent, { EventType::end, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::endEventEvent, { EventType::endEvent, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::endedEvent, { EventType::ended, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::endstreamingEvent, { EventType::endstreaming, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::enterEvent, { EventType::enter, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::enterpictureinpictureEvent, { EventType::enterpictureinpicture, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::errorEvent, { EventType::error, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::exitEvent, { EventType::exit, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::fetchEvent, { EventType::fetch, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::finishEvent, { EventType::finish, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::focusEvent, { EventType::focus, {}, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::focusinEvent, { EventType::focusin, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::focusoutEvent, { EventType::focusout, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::formdataEvent, { EventType::formdata, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::fullscreenchangeEvent, { EventType::fullscreenchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::fullscreenerrorEvent, { EventType::fullscreenerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gamepadconnectedEvent, { EventType::gamepadconnected, { EventCategory::Gamepad }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gamepaddisconnectedEvent, { EventType::gamepaddisconnected, { EventCategory::Gamepad }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gatheringstatechangeEvent, { EventType::gatheringstatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gesturechangeEvent, { EventType::gesturechange, { EventCategory::Gesture }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gestureendEvent, { EventType::gestureend, { EventCategory::Gesture }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gesturescrollendEvent, { EventType::gesturescrollend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gesturescrollstartEvent, { EventType::gesturescrollstart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gesturescrollupdateEvent, { EventType::gesturescrollupdate, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gesturestartEvent, { EventType::gesturestart, { EventCategory::Gesture }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gesturetapEvent, { EventType::gesturetap, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gesturetapdownEvent, { EventType::gesturetapdown, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::gotpointercaptureEvent, { EventType::gotpointercapture, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::hashchangeEvent, { EventType::hashchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::icecandidateEvent, { EventType::icecandidate, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::icecandidateerrorEvent, { EventType::icecandidateerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::iceconnectionstatechangeEvent, { EventType::iceconnectionstatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::icegatheringstatechangeEvent, { EventType::icegatheringstatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::immersivechangeEvent, { EventType::immersivechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::immersiveerrorEvent, { EventType::immersiveerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::inactiveEvent, { EventType::inactive, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::inputEvent, { EventType::input, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::inputsourceschangeEvent, { EventType::inputsourceschange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::installEvent, { EventType::install, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::invalidEvent, { EventType::invalid, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::keydownEvent, { EventType::keydown, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::keypressEvent, { EventType::keypress, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::keystatuseschangeEvent, { EventType::keystatuseschange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::keyupEvent, { EventType::keyup, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::languagechangeEvent, { EventType::languagechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::leavepictureinpictureEvent, { EventType::leavepictureinpicture, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::levelchangeEvent, { EventType::levelchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadEvent, { EventType::load, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadeddataEvent, { EventType::loadeddata, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadedmetadataEvent, { EventType::loadedmetadata, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadendEvent, { EventType::loadend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadingEvent, { EventType::loading, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadingdoneEvent, { EventType::loadingdone, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadingerrorEvent, { EventType::loadingerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::loadstartEvent, { EventType::loadstart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::lostpointercaptureEvent, { EventType::lostpointercapture, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::markEvent, { EventType::mark, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::merchantvalidationEvent, { EventType::merchantvalidation, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::messageEvent, { EventType::message, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::messageerrorEvent, { EventType::messageerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::mousedownEvent, { EventType::mousedown, { EventCategory::MouseClickRelated, EventCategory::SimulatedMouse, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::mouseenterEvent, { EventType::mouseenter, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::mouseleaveEvent, { EventType::mouseleave, { EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::mousemoveEvent, { EventType::mousemove, { EventCategory::MouseMoveRelated, EventCategory::SimulatedMouse, EventCategory::ExtendedTouchRelated }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::mouseoutEvent, { EventType::mouseout, { EventCategory::MouseMoveRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::mouseoverEvent, { EventType::mouseover, { EventCategory::MouseMoveRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::mouseupEvent, { EventType::mouseup, { EventCategory::MouseClickRelated, EventCategory::SimulatedMouse, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::mousewheelEvent, { EventType::mousewheel, { EventCategory::Wheel }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::muteEvent, { EventType::mute, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::navigateEvent, { EventType::navigate, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::navigateerrorEvent, { EventType::navigateerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::navigatesuccessEvent, { EventType::navigatesuccess, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::negotiationneededEvent, { EventType::negotiationneeded, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::nexttrackEvent, { EventType::nexttrack, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::nomatchEvent, { EventType::nomatch, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::notificationclickEvent, { EventType::notificationclick, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::notificationcloseEvent, { EventType::notificationclose, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::noupdateEvent, { EventType::noupdate, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::obsoleteEvent, { EventType::obsolete, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::offlineEvent, { EventType::offline, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::onlineEvent, { EventType::online, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::openEvent, { EventType::open, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::orientationchangeEvent, { EventType::orientationchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pagehideEvent, { EventType::pagehide, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pagerevealEvent, { EventType::pagereveal, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pageshowEvent, { EventType::pageshow, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pageswapEvent, { EventType::pageswap, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::paintEvent, { EventType::paint, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pasteEvent, { EventType::paste, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pauseEvent, { EventType::pause, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::payerdetailchangeEvent, { EventType::payerdetailchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::paymentauthorizedEvent, { EventType::paymentauthorized, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::paymentmethodchangeEvent, { EventType::paymentmethodchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::paymentmethodselectedEvent, { EventType::paymentmethodselected, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::playEvent, { EventType::play, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::playingEvent, { EventType::playing, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pointercancelEvent, { EventType::pointercancel, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::pointerdownEvent, { EventType::pointerdown, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::pointerenterEvent, { EventType::pointerenter, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::pointerleaveEvent, { EventType::pointerleave, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::pointerlockchangeEvent, { EventType::pointerlockchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pointerlockerrorEvent, { EventType::pointerlockerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pointermoveEvent, { EventType::pointermove, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::pointeroutEvent, { EventType::pointerout, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::pointeroverEvent, { EventType::pointerover, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::pointerupEvent, { EventType::pointerup, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::popstateEvent, { EventType::popstate, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::previoustrackEvent, { EventType::previoustrack, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::processorerrorEvent, { EventType::processorerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::progressEvent, { EventType::progress, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pushEvent, { EventType::push, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::pushsubscriptionchangeEvent, { EventType::pushsubscriptionchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::qualitychangeEvent, { EventType::qualitychange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::ratechangeEvent, { EventType::ratechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::readystatechangeEvent, { EventType::readystatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::redrawEvent, { EventType::redraw, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::rejectionhandledEvent, { EventType::rejectionhandled, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::releaseEvent, { EventType::release, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::removeEvent, { EventType::remove, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::removesourcebufferEvent, { EventType::removesourcebuffer, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::removestreamEvent, { EventType::removestream, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::removetrackEvent, { EventType::removetrack, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::repeatEvent, { EventType::repeat, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::repeatEventEvent, { EventType::repeatEvent, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::resetEvent, { EventType::reset, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::resizeEvent, { EventType::resize, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::resourcetimingbufferfullEvent, { EventType::resourcetimingbufferfull, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::resultEvent, { EventType::result, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::resumeEvent, { EventType::resume, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::rtctransformEvent, { EventType::rtctransform, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::scrollEvent, { EventType::scroll, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::scrollendEvent, { EventType::scrollend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::securitypolicyviolationEvent, { EventType::securitypolicyviolation, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::seekedEvent, { EventType::seeked, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::seekingEvent, { EventType::seeking, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::selectEvent, { EventType::select, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::selectedcandidatepairchangeEvent, { EventType::selectedcandidatepairchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::selectendEvent, { EventType::selectend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::selectionchangeEvent, { EventType::selectionchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::selectstartEvent, { EventType::selectstart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::shippingaddresschangeEvent, { EventType::shippingaddresschange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::shippingcontactselectedEvent, { EventType::shippingcontactselected, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::shippingmethodselectedEvent, { EventType::shippingmethodselected, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::shippingoptionchangeEvent, { EventType::shippingoptionchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::showEvent, { EventType::show, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::signalingstatechangeEvent, { EventType::signalingstatechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::slotchangeEvent, { EventType::slotchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::soundendEvent, { EventType::soundend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::soundstartEvent, { EventType::soundstart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::sourcecloseEvent, { EventType::sourceclose, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::sourceendedEvent, { EventType::sourceended, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::sourceopenEvent, { EventType::sourceopen, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::speechendEvent, { EventType::speechend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::speechstartEvent, { EventType::speechstart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::squeezeEvent, { EventType::squeeze, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::squeezeendEvent, { EventType::squeezeend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::squeezestartEvent, { EventType::squeezestart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::stalledEvent, { EventType::stalled, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::startEvent, { EventType::start, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::startedEvent, { EventType::started, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::startstreamingEvent, { EventType::startstreaming, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::statechangeEvent, { EventType::statechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::stopEvent, { EventType::stop, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::storageEvent, { EventType::storage, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::submitEvent, { EventType::submit, {}, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::successEvent, { EventType::success, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::suspendEvent, { EventType::suspend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::textInputEvent, { EventType::textInput, {}, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::timeoutEvent, { EventType::timeout, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::timeupdateEvent, { EventType::timeupdate, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::toggleEvent, { EventType::toggle, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::tonechangeEvent, { EventType::tonechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::touchcancelEvent, { EventType::touchcancel, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::touchendEvent, { EventType::touchend, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::touchforcechangeEvent, { EventType::touchforcechange, { EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::touchmoveEvent, { EventType::touchmove, { EventCategory::TouchScrollBlocking, EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::touchstartEvent, { EventType::touchstart, { EventCategory::TouchScrollBlocking, EventCategory::TouchRelated, EventCategory::ExtendedTouchRelated, EventCategory::EventTimingEligible }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::trackEvent, { EventType::track, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::transitioncancelEvent, { EventType::transitioncancel, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::transitionendEvent, { EventType::transitionend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::transitionrunEvent, { EventType::transitionrun, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::transitionstartEvent, { EventType::transitionstart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::uncapturederrorEvent, { EventType::uncapturederror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::unhandledrejectionEvent, { EventType::unhandledrejection, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::unloadEvent, { EventType::unload, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::unmuteEvent, { EventType::unmute, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::updateEvent, { EventType::update, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::updateendEvent, { EventType::updateend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::updatefoundEvent, { EventType::updatefound, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::updatereadyEvent, { EventType::updateready, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::updatestartEvent, { EventType::updatestart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::upgradeneededEvent, { EventType::upgradeneeded, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::validatemerchantEvent, { EventType::validatemerchant, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::versionchangeEvent, { EventType::versionchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::visibilitychangeEvent, { EventType::visibilitychange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::voiceschangedEvent, { EventType::voiceschanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::volumechangeEvent, { EventType::volumechange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::waitingEvent, { EventType::waiting, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::waitingforkeyEvent, { EventType::waitingforkey, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webglcontextcreationerrorEvent, { EventType::webglcontextcreationerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webglcontextlostEvent, { EventType::webglcontextlost, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webglcontextrestoredEvent, { EventType::webglcontextrestored, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitAnimationEndEvent, { EventType::webkitAnimationEnd, { EventCategory::CSSAnimation }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitAnimationIterationEvent, { EventType::webkitAnimationIteration, { EventCategory::CSSAnimation }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitAnimationStartEvent, { EventType::webkitAnimationStart, { EventCategory::CSSAnimation }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitBeforeTextInsertedEvent, { EventType::webkitBeforeTextInserted, {}, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::webkitTransitionEndEvent, { EventType::webkitTransitionEnd, { EventCategory::CSSTransition }, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitassociateformcontrolsEvent, { EventType::webkitassociateformcontrols, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitautofillrequestEvent, { EventType::webkitautofillrequest, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitbeforeblurEvent, { EventType::webkitbeforeblur, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitbeforefocusEvent, { EventType::webkitbeforefocus, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitbeginfullscreenEvent, { EventType::webkitbeginfullscreen, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitcameramovedEvent, { EventType::webkitcameramoved, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitcameraviewchangedEvent, { EventType::webkitcameraviewchanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitcurrentplaybacktargetiswirelesschangedEvent, { EventType::webkitcurrentplaybacktargetiswirelesschanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitendfullscreenEvent, { EventType::webkitendfullscreen, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitexternalplaybackchangedEvent, { EventType::webkitexternalplaybackchanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitfocusedelementdisconnectedEvent, { EventType::webkitfocusedelementdisconnected, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitfullscreenchangeEvent, { EventType::webkitfullscreenchange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitfullscreenerrorEvent, { EventType::webkitfullscreenerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitkeyaddedEvent, { EventType::webkitkeyadded, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitkeyerrorEvent, { EventType::webkitkeyerror, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitkeymessageEvent, { EventType::webkitkeymessage, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitmediasessionmetadatachangedEvent, { EventType::webkitmediasessionmetadatachanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitmouseforcechangedEvent, { EventType::webkitmouseforcechanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitmouseforcedownEvent, { EventType::webkitmouseforcedown, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitmouseforceupEvent, { EventType::webkitmouseforceup, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitmouseforcewillbeginEvent, { EventType::webkitmouseforcewillbegin, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitneedkeyEvent, { EventType::webkitneedkey, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitnetworkinfochangeEvent, { EventType::webkitnetworkinfochange, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitplaybacktargetavailabilitychangedEvent, { EventType::webkitplaybacktargetavailabilitychanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitpresentationmodechangedEvent, { EventType::webkitpresentationmodechanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitprojectionchangedEvent, { EventType::webkitprojectionchanged, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitremovesourcebufferEvent, { EventType::webkitremovesourcebuffer, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitsourcecloseEvent, { EventType::webkitsourceclose, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitsourceendedEvent, { EventType::webkitsourceended, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitsourceopenEvent, { EventType::webkitsourceopen, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitsubmitEvent, { EventType::webkitsubmit, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::webkitusertextinputEvent, { EventType::webkitusertextinput, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::wheelEvent, { EventType::wheel, { EventCategory::Wheel }, EventTypeInfo::DefaultEventHandler::Yes } },
        { &EventNames::writeEvent, { EventType::write, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::writeendEvent, { EventType::writeend, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::writestartEvent, { EventType::writestart, {}, EventTypeInfo::DefaultEventHandler::No } },
        { &EventNames::zoomEvent, { EventType::zoom, {}, EventTypeInfo::DefaultEventHandler::No } },
    };
    m_typeInfoMap.reserveInitialCapacity(std::size(typeInfoEntries));
    for (auto& entry : typeInfoEntries)
        m_typeInfoMap.add(this->*entry.name, entry.info);
}

__attribute__((minsize)) EventNames::~EventNames() = default;

std::array<const AtomString, 340> EventNames::allEventNames() const
{
    return { {
        DOMActivateEvent,
        DOMCharacterDataModifiedEvent,
        DOMContentLoadedEvent,
        DOMNodeInsertedEvent,
        DOMNodeInsertedIntoDocumentEvent,
        DOMNodeRemovedEvent,
        DOMNodeRemovedFromDocumentEvent,
        DOMSubtreeModifiedEvent,
        abortEvent,
        activateEvent,
        activeEvent,
        addsourcebufferEvent,
        addstreamEvent,
        addtrackEvent,
        afterprintEvent,
        animationcancelEvent,
        animationendEvent,
        animationiterationEvent,
        animationstartEvent,
        audioendEvent,
        audioprocessEvent,
        audiostartEvent,
        autocompleteEvent,
        autocompleteerrorEvent,
        auxclickEvent,
        backgroundfetchabortEvent,
        backgroundfetchclickEvent,
        backgroundfetchfailEvent,
        backgroundfetchsuccessEvent,
        beforecopyEvent,
        beforecutEvent,
        beforeinputEvent,
        beforeloadEvent,
        beforematchEvent,
        beforepasteEvent,
        beforeprintEvent,
        beforetoggleEvent,
        beforeunloadEvent,
        beginEvent,
        beginEventEvent,
        blockedEvent,
        blurEvent,
        boundaryEvent,
        bufferedamountlowEvent,
        bufferedchangeEvent,
        cachedEvent,
        cancelEvent,
        canplayEvent,
        canplaythroughEvent,
        changeEvent,
        chargingchangeEvent,
        chargingtimechangeEvent,
        checkingEvent,
        clickEvent,
        closeEvent,
        closingEvent,
        commandEvent,
        completeEvent,
        compositionendEvent,
        compositionstartEvent,
        compositionupdateEvent,
        configurationchangeEvent,
        connectEvent,
        connectingEvent,
        connectionstatechangeEvent,
        contentvisibilityautostatechangeEvent,
        contextmenuEvent,
        controllerchangeEvent,
        cookiechangeEvent,
        coordinatorstatechangeEvent,
        copyEvent,
#if ENABLE(APPLE_PAY_COUPON_CODE)
        couponcodechangedEvent,
#endif
        cuechangeEvent,
        currententrychangeEvent,
        cutEvent,
        dataavailableEvent,
        datachannelEvent,
        dblclickEvent,
        dequeueEvent,
        devicechangeEvent,
        devicemotionEvent,
        deviceorientationEvent,
        dischargingtimechangeEvent,
        disconnectEvent,
        disposeEvent,
        downloadingEvent,
        dragEvent,
        dragendEvent,
        dragenterEvent,
        dragleaveEvent,
        dragoverEvent,
        dragstartEvent,
        dropEvent,
        durationchangeEvent,
        emptiedEvent,
        encryptedEvent,
        endEvent,
        endEventEvent,
        endedEvent,
        endstreamingEvent,
        enterEvent,
        enterpictureinpictureEvent,
        errorEvent,
        exitEvent,
        fetchEvent,
        finishEvent,
        focusEvent,
        focusinEvent,
        focusoutEvent,
        formdataEvent,
        fullscreenchangeEvent,
        fullscreenerrorEvent,
        gamepadconnectedEvent,
        gamepaddisconnectedEvent,
        gatheringstatechangeEvent,
        gesturechangeEvent,
        gestureendEvent,
        gesturescrollendEvent,
        gesturescrollstartEvent,
        gesturescrollupdateEvent,
        gesturestartEvent,
        gesturetapEvent,
        gesturetapdownEvent,
        gotpointercaptureEvent,
        hashchangeEvent,
        icecandidateEvent,
        icecandidateerrorEvent,
        iceconnectionstatechangeEvent,
        icegatheringstatechangeEvent,
        immersivechangeEvent,
        immersiveerrorEvent,
        inactiveEvent,
        inputEvent,
        inputsourceschangeEvent,
        installEvent,
        invalidEvent,
        keydownEvent,
        keypressEvent,
        keystatuseschangeEvent,
        keyupEvent,
        languagechangeEvent,
        leavepictureinpictureEvent,
        levelchangeEvent,
        loadEvent,
        loadeddataEvent,
        loadedmetadataEvent,
        loadendEvent,
        loadingEvent,
        loadingdoneEvent,
        loadingerrorEvent,
        loadstartEvent,
        lostpointercaptureEvent,
        markEvent,
        merchantvalidationEvent,
        messageEvent,
        messageerrorEvent,
        mousedownEvent,
        mouseenterEvent,
        mouseleaveEvent,
        mousemoveEvent,
        mouseoutEvent,
        mouseoverEvent,
        mouseupEvent,
        mousewheelEvent,
        muteEvent,
        navigateEvent,
        navigateerrorEvent,
        navigatesuccessEvent,
        negotiationneededEvent,
        nexttrackEvent,
        nomatchEvent,
        notificationclickEvent,
        notificationcloseEvent,
        noupdateEvent,
        obsoleteEvent,
        offlineEvent,
        onlineEvent,
        openEvent,
        orientationchangeEvent,
        pagehideEvent,
        pagerevealEvent,
        pageshowEvent,
        pageswapEvent,
        paintEvent,
        pasteEvent,
        pauseEvent,
        payerdetailchangeEvent,
        paymentauthorizedEvent,
        paymentmethodchangeEvent,
        paymentmethodselectedEvent,
        playEvent,
        playingEvent,
        pointercancelEvent,
        pointerdownEvent,
        pointerenterEvent,
        pointerleaveEvent,
        pointerlockchangeEvent,
        pointerlockerrorEvent,
        pointermoveEvent,
        pointeroutEvent,
        pointeroverEvent,
        pointerupEvent,
        popstateEvent,
        previoustrackEvent,
        processorerrorEvent,
        progressEvent,
        pushEvent,
        pushsubscriptionchangeEvent,
        qualitychangeEvent,
        ratechangeEvent,
        readystatechangeEvent,
        redrawEvent,
        rejectionhandledEvent,
        releaseEvent,
        removeEvent,
        removesourcebufferEvent,
        removestreamEvent,
        removetrackEvent,
        repeatEvent,
        repeatEventEvent,
        resetEvent,
        resizeEvent,
        resourcetimingbufferfullEvent,
        resultEvent,
        resumeEvent,
        rtctransformEvent,
        scrollEvent,
        scrollendEvent,
        securitypolicyviolationEvent,
        seekedEvent,
        seekingEvent,
        selectEvent,
        selectedcandidatepairchangeEvent,
        selectendEvent,
        selectionchangeEvent,
        selectstartEvent,
        shippingaddresschangeEvent,
        shippingcontactselectedEvent,
        shippingmethodselectedEvent,
        shippingoptionchangeEvent,
        showEvent,
        signalingstatechangeEvent,
        slotchangeEvent,
        soundendEvent,
        soundstartEvent,
        sourcecloseEvent,
        sourceendedEvent,
        sourceopenEvent,
        speechendEvent,
        speechstartEvent,
        squeezeEvent,
        squeezeendEvent,
        squeezestartEvent,
        stalledEvent,
        startEvent,
        startedEvent,
        startstreamingEvent,
        statechangeEvent,
        stopEvent,
        storageEvent,
        submitEvent,
        successEvent,
        suspendEvent,
        textInputEvent,
        timeoutEvent,
        timeupdateEvent,
        toggleEvent,
        tonechangeEvent,
        touchcancelEvent,
        touchendEvent,
        touchforcechangeEvent,
        touchmoveEvent,
        touchstartEvent,
        trackEvent,
        transitioncancelEvent,
        transitionendEvent,
        transitionrunEvent,
        transitionstartEvent,
        uncapturederrorEvent,
        unhandledrejectionEvent,
        unloadEvent,
        unmuteEvent,
        updateEvent,
        updateendEvent,
        updatefoundEvent,
        updatereadyEvent,
        updatestartEvent,
        upgradeneededEvent,
        validatemerchantEvent,
        versionchangeEvent,
        visibilitychangeEvent,
        voiceschangedEvent,
        volumechangeEvent,
        waitingEvent,
        waitingforkeyEvent,
        webglcontextcreationerrorEvent,
        webglcontextlostEvent,
        webglcontextrestoredEvent,
        webkitAnimationEndEvent,
        webkitAnimationIterationEvent,
        webkitAnimationStartEvent,
        webkitBeforeTextInsertedEvent,
        webkitTransitionEndEvent,
        webkitassociateformcontrolsEvent,
        webkitautofillrequestEvent,
        webkitbeforeblurEvent,
        webkitbeforefocusEvent,
        webkitbeginfullscreenEvent,
        webkitcameramovedEvent,
        webkitcameraviewchangedEvent,
        webkitcurrentplaybacktargetiswirelesschangedEvent,
        webkitendfullscreenEvent,
        webkitexternalplaybackchangedEvent,
        webkitfocusedelementdisconnectedEvent,
        webkitfullscreenchangeEvent,
        webkitfullscreenerrorEvent,
        webkitkeyaddedEvent,
        webkitkeyerrorEvent,
        webkitkeymessageEvent,
        webkitmediasessionmetadatachangedEvent,
        webkitmouseforcechangedEvent,
        webkitmouseforcedownEvent,
        webkitmouseforceupEvent,
        webkitmouseforcewillbeginEvent,
        webkitneedkeyEvent,
        webkitnetworkinfochangeEvent,
        webkitplaybacktargetavailabilitychangedEvent,
        webkitpresentationmodechangedEvent,
        webkitprojectionchangedEvent,
        webkitremovesourcebufferEvent,
        webkitsourcecloseEvent,
        webkitsourceendedEvent,
        webkitsourceopenEvent,
        webkitsubmitEvent,
        webkitusertextinputEvent,
        wheelEvent,
        writeEvent,
        writeendEvent,
        writestartEvent,
        zoomEvent,
    } };
}

WTF::HashSet<AtomString> EventNames::allEventHandlerNames() const
{
    WTF::HashSet<AtomString> set;
    set.add("ondomactivate"_s);
    set.add("ondomcharacterdatamodified"_s);
    set.add("ondomcontentloaded"_s);
    set.add("ondomnodeinserted"_s);
    set.add("ondomnodeinsertedintodocument"_s);
    set.add("ondomnoderemoved"_s);
    set.add("ondomnoderemovedfromdocument"_s);
    set.add("ondomsubtreemodified"_s);
    set.add("onabort"_s);
    set.add("onactivate"_s);
    set.add("onactive"_s);
    set.add("onaddsourcebuffer"_s);
    set.add("onaddstream"_s);
    set.add("onaddtrack"_s);
    set.add("onafterprint"_s);
    set.add("onanimationcancel"_s);
    set.add("onanimationend"_s);
    set.add("onanimationiteration"_s);
    set.add("onanimationstart"_s);
    set.add("onaudioend"_s);
    set.add("onaudioprocess"_s);
    set.add("onaudiostart"_s);
    set.add("onautocomplete"_s);
    set.add("onautocompleteerror"_s);
    set.add("onauxclick"_s);
    set.add("onbackgroundfetchabort"_s);
    set.add("onbackgroundfetchclick"_s);
    set.add("onbackgroundfetchfail"_s);
    set.add("onbackgroundfetchsuccess"_s);
    set.add("onbeforecopy"_s);
    set.add("onbeforecut"_s);
    set.add("onbeforeinput"_s);
    set.add("onbeforeload"_s);
    set.add("onbeforematch"_s);
    set.add("onbeforepaste"_s);
    set.add("onbeforeprint"_s);
    set.add("onbeforetoggle"_s);
    set.add("onbeforeunload"_s);
    set.add("onbegin"_s);
    set.add("onbeginevent"_s);
    set.add("onblocked"_s);
    set.add("onblur"_s);
    set.add("onboundary"_s);
    set.add("onbufferedamountlow"_s);
    set.add("onbufferedchange"_s);
    set.add("oncached"_s);
    set.add("oncancel"_s);
    set.add("oncanplay"_s);
    set.add("oncanplaythrough"_s);
    set.add("onchange"_s);
    set.add("onchargingchange"_s);
    set.add("onchargingtimechange"_s);
    set.add("onchecking"_s);
    set.add("onclick"_s);
    set.add("onclose"_s);
    set.add("onclosing"_s);
    set.add("oncommand"_s);
    set.add("oncomplete"_s);
    set.add("oncompositionend"_s);
    set.add("oncompositionstart"_s);
    set.add("oncompositionupdate"_s);
    set.add("onconfigurationchange"_s);
    set.add("onconnect"_s);
    set.add("onconnecting"_s);
    set.add("onconnectionstatechange"_s);
    set.add("oncontentvisibilityautostatechange"_s);
    set.add("oncontextmenu"_s);
    set.add("oncontrollerchange"_s);
    set.add("oncookiechange"_s);
    set.add("oncoordinatorstatechange"_s);
    set.add("oncopy"_s);
#if ENABLE(APPLE_PAY_COUPON_CODE)
    set.add("oncouponcodechanged"_s);
#endif
    set.add("oncuechange"_s);
    set.add("oncurrententrychange"_s);
    set.add("oncut"_s);
    set.add("ondataavailable"_s);
    set.add("ondatachannel"_s);
    set.add("ondblclick"_s);
    set.add("ondequeue"_s);
    set.add("ondevicechange"_s);
    set.add("ondevicemotion"_s);
    set.add("ondeviceorientation"_s);
    set.add("ondischargingtimechange"_s);
    set.add("ondisconnect"_s);
    set.add("ondispose"_s);
    set.add("ondownloading"_s);
    set.add("ondrag"_s);
    set.add("ondragend"_s);
    set.add("ondragenter"_s);
    set.add("ondragleave"_s);
    set.add("ondragover"_s);
    set.add("ondragstart"_s);
    set.add("ondrop"_s);
    set.add("ondurationchange"_s);
    set.add("onemptied"_s);
    set.add("onencrypted"_s);
    set.add("onend"_s);
    set.add("onendevent"_s);
    set.add("onended"_s);
    set.add("onendstreaming"_s);
    set.add("onenter"_s);
    set.add("onenterpictureinpicture"_s);
    set.add("onerror"_s);
    set.add("onexit"_s);
    set.add("onfetch"_s);
    set.add("onfinish"_s);
    set.add("onfocus"_s);
    set.add("onfocusin"_s);
    set.add("onfocusout"_s);
    set.add("onformdata"_s);
    set.add("onfullscreenchange"_s);
    set.add("onfullscreenerror"_s);
    set.add("ongamepadconnected"_s);
    set.add("ongamepaddisconnected"_s);
    set.add("ongatheringstatechange"_s);
    set.add("ongesturechange"_s);
    set.add("ongestureend"_s);
    set.add("ongesturescrollend"_s);
    set.add("ongesturescrollstart"_s);
    set.add("ongesturescrollupdate"_s);
    set.add("ongesturestart"_s);
    set.add("ongesturetap"_s);
    set.add("ongesturetapdown"_s);
    set.add("ongotpointercapture"_s);
    set.add("onhashchange"_s);
    set.add("onicecandidate"_s);
    set.add("onicecandidateerror"_s);
    set.add("oniceconnectionstatechange"_s);
    set.add("onicegatheringstatechange"_s);
    set.add("onimmersivechange"_s);
    set.add("onimmersiveerror"_s);
    set.add("oninactive"_s);
    set.add("oninput"_s);
    set.add("oninputsourceschange"_s);
    set.add("oninstall"_s);
    set.add("oninvalid"_s);
    set.add("onkeydown"_s);
    set.add("onkeypress"_s);
    set.add("onkeystatuseschange"_s);
    set.add("onkeyup"_s);
    set.add("onlanguagechange"_s);
    set.add("onleavepictureinpicture"_s);
    set.add("onlevelchange"_s);
    set.add("onload"_s);
    set.add("onloadeddata"_s);
    set.add("onloadedmetadata"_s);
    set.add("onloadend"_s);
    set.add("onloading"_s);
    set.add("onloadingdone"_s);
    set.add("onloadingerror"_s);
    set.add("onloadstart"_s);
    set.add("onlostpointercapture"_s);
    set.add("onmark"_s);
    set.add("onmerchantvalidation"_s);
    set.add("onmessage"_s);
    set.add("onmessageerror"_s);
    set.add("onmousedown"_s);
    set.add("onmouseenter"_s);
    set.add("onmouseleave"_s);
    set.add("onmousemove"_s);
    set.add("onmouseout"_s);
    set.add("onmouseover"_s);
    set.add("onmouseup"_s);
    set.add("onmousewheel"_s);
    set.add("onmute"_s);
    set.add("onnavigate"_s);
    set.add("onnavigateerror"_s);
    set.add("onnavigatesuccess"_s);
    set.add("onnegotiationneeded"_s);
    set.add("onnexttrack"_s);
    set.add("onnomatch"_s);
    set.add("onnotificationclick"_s);
    set.add("onnotificationclose"_s);
    set.add("onnoupdate"_s);
    set.add("onobsolete"_s);
    set.add("onoffline"_s);
    set.add("ononline"_s);
    set.add("onopen"_s);
    set.add("onorientationchange"_s);
    set.add("onpagehide"_s);
    set.add("onpagereveal"_s);
    set.add("onpageshow"_s);
    set.add("onpageswap"_s);
    set.add("onpaint"_s);
    set.add("onpaste"_s);
    set.add("onpause"_s);
    set.add("onpayerdetailchange"_s);
    set.add("onpaymentauthorized"_s);
    set.add("onpaymentmethodchange"_s);
    set.add("onpaymentmethodselected"_s);
    set.add("onplay"_s);
    set.add("onplaying"_s);
    set.add("onpointercancel"_s);
    set.add("onpointerdown"_s);
    set.add("onpointerenter"_s);
    set.add("onpointerleave"_s);
    set.add("onpointerlockchange"_s);
    set.add("onpointerlockerror"_s);
    set.add("onpointermove"_s);
    set.add("onpointerout"_s);
    set.add("onpointerover"_s);
    set.add("onpointerup"_s);
    set.add("onpopstate"_s);
    set.add("onprevioustrack"_s);
    set.add("onprocessorerror"_s);
    set.add("onprogress"_s);
    set.add("onpush"_s);
    set.add("onpushsubscriptionchange"_s);
    set.add("onqualitychange"_s);
    set.add("onratechange"_s);
    set.add("onreadystatechange"_s);
    set.add("onredraw"_s);
    set.add("onrejectionhandled"_s);
    set.add("onrelease"_s);
    set.add("onremove"_s);
    set.add("onremovesourcebuffer"_s);
    set.add("onremovestream"_s);
    set.add("onremovetrack"_s);
    set.add("onrepeat"_s);
    set.add("onrepeatevent"_s);
    set.add("onreset"_s);
    set.add("onresize"_s);
    set.add("onresourcetimingbufferfull"_s);
    set.add("onresult"_s);
    set.add("onresume"_s);
    set.add("onrtctransform"_s);
    set.add("onscroll"_s);
    set.add("onscrollend"_s);
    set.add("onsecuritypolicyviolation"_s);
    set.add("onseeked"_s);
    set.add("onseeking"_s);
    set.add("onselect"_s);
    set.add("onselectedcandidatepairchange"_s);
    set.add("onselectend"_s);
    set.add("onselectionchange"_s);
    set.add("onselectstart"_s);
    set.add("onshippingaddresschange"_s);
    set.add("onshippingcontactselected"_s);
    set.add("onshippingmethodselected"_s);
    set.add("onshippingoptionchange"_s);
    set.add("onshow"_s);
    set.add("onsignalingstatechange"_s);
    set.add("onslotchange"_s);
    set.add("onsoundend"_s);
    set.add("onsoundstart"_s);
    set.add("onsourceclose"_s);
    set.add("onsourceended"_s);
    set.add("onsourceopen"_s);
    set.add("onspeechend"_s);
    set.add("onspeechstart"_s);
    set.add("onsqueeze"_s);
    set.add("onsqueezeend"_s);
    set.add("onsqueezestart"_s);
    set.add("onstalled"_s);
    set.add("onstart"_s);
    set.add("onstarted"_s);
    set.add("onstartstreaming"_s);
    set.add("onstatechange"_s);
    set.add("onstop"_s);
    set.add("onstorage"_s);
    set.add("onsubmit"_s);
    set.add("onsuccess"_s);
    set.add("onsuspend"_s);
    set.add("ontextinput"_s);
    set.add("ontimeout"_s);
    set.add("ontimeupdate"_s);
    set.add("ontoggle"_s);
    set.add("ontonechange"_s);
    set.add("ontouchcancel"_s);
    set.add("ontouchend"_s);
    set.add("ontouchforcechange"_s);
    set.add("ontouchmove"_s);
    set.add("ontouchstart"_s);
    set.add("ontrack"_s);
    set.add("ontransitioncancel"_s);
    set.add("ontransitionend"_s);
    set.add("ontransitionrun"_s);
    set.add("ontransitionstart"_s);
    set.add("onuncapturederror"_s);
    set.add("onunhandledrejection"_s);
    set.add("onunload"_s);
    set.add("onunmute"_s);
    set.add("onupdate"_s);
    set.add("onupdateend"_s);
    set.add("onupdatefound"_s);
    set.add("onupdateready"_s);
    set.add("onupdatestart"_s);
    set.add("onupgradeneeded"_s);
    set.add("onvalidatemerchant"_s);
    set.add("onversionchange"_s);
    set.add("onvisibilitychange"_s);
    set.add("onvoiceschanged"_s);
    set.add("onvolumechange"_s);
    set.add("onwaiting"_s);
    set.add("onwaitingforkey"_s);
    set.add("onwebglcontextcreationerror"_s);
    set.add("onwebglcontextlost"_s);
    set.add("onwebglcontextrestored"_s);
    set.add("onwebkitanimationend"_s);
    set.add("onwebkitanimationiteration"_s);
    set.add("onwebkitanimationstart"_s);
    set.add("onwebkitbeforetextinserted"_s);
    set.add("onwebkittransitionend"_s);
    set.add("onwebkitassociateformcontrols"_s);
    set.add("onwebkitautofillrequest"_s);
    set.add("onwebkitbeforeblur"_s);
    set.add("onwebkitbeforefocus"_s);
    set.add("onwebkitbeginfullscreen"_s);
    set.add("onwebkitcameramoved"_s);
    set.add("onwebkitcameraviewchanged"_s);
    set.add("onwebkitcurrentplaybacktargetiswirelesschanged"_s);
    set.add("onwebkitendfullscreen"_s);
    set.add("onwebkitexternalplaybackchanged"_s);
    set.add("onwebkitfocusedelementdisconnected"_s);
    set.add("onwebkitfullscreenchange"_s);
    set.add("onwebkitfullscreenerror"_s);
    set.add("onwebkitkeyadded"_s);
    set.add("onwebkitkeyerror"_s);
    set.add("onwebkitkeymessage"_s);
    set.add("onwebkitmediasessionmetadatachanged"_s);
    set.add("onwebkitmouseforcechanged"_s);
    set.add("onwebkitmouseforcedown"_s);
    set.add("onwebkitmouseforceup"_s);
    set.add("onwebkitmouseforcewillbegin"_s);
    set.add("onwebkitneedkey"_s);
    set.add("onwebkitnetworkinfochange"_s);
    set.add("onwebkitplaybacktargetavailabilitychanged"_s);
    set.add("onwebkitpresentationmodechanged"_s);
    set.add("onwebkitprojectionchanged"_s);
    set.add("onwebkitremovesourcebuffer"_s);
    set.add("onwebkitsourceclose"_s);
    set.add("onwebkitsourceended"_s);
    set.add("onwebkitsourceopen"_s);
    set.add("onwebkitsubmit"_s);
    set.add("onwebkitusertextinput"_s);
    set.add("onwheel"_s);
    set.add("onwrite"_s);
    set.add("onwriteend"_s);
    set.add("onwritestart"_s);
    set.add("onzoom"_s);
    return set;
}

static constexpr std::array<const AtomString EventNames::*, 340> eventStringInEventNames {
    &EventNames::DOMActivateEvent,
    &EventNames::DOMCharacterDataModifiedEvent,
    &EventNames::DOMContentLoadedEvent,
    &EventNames::DOMNodeInsertedEvent,
    &EventNames::DOMNodeInsertedIntoDocumentEvent,
    &EventNames::DOMNodeRemovedEvent,
    &EventNames::DOMNodeRemovedFromDocumentEvent,
    &EventNames::DOMSubtreeModifiedEvent,
    &EventNames::abortEvent,
    &EventNames::activateEvent,
    &EventNames::activeEvent,
    &EventNames::addsourcebufferEvent,
    &EventNames::addstreamEvent,
    &EventNames::addtrackEvent,
    &EventNames::afterprintEvent,
    &EventNames::animationcancelEvent,
    &EventNames::animationendEvent,
    &EventNames::animationiterationEvent,
    &EventNames::animationstartEvent,
    &EventNames::audioendEvent,
    &EventNames::audioprocessEvent,
    &EventNames::audiostartEvent,
    &EventNames::autocompleteEvent,
    &EventNames::autocompleteerrorEvent,
    &EventNames::auxclickEvent,
    &EventNames::backgroundfetchabortEvent,
    &EventNames::backgroundfetchclickEvent,
    &EventNames::backgroundfetchfailEvent,
    &EventNames::backgroundfetchsuccessEvent,
    &EventNames::beforecopyEvent,
    &EventNames::beforecutEvent,
    &EventNames::beforeinputEvent,
    &EventNames::beforeloadEvent,
    &EventNames::beforematchEvent,
    &EventNames::beforepasteEvent,
    &EventNames::beforeprintEvent,
    &EventNames::beforetoggleEvent,
    &EventNames::beforeunloadEvent,
    &EventNames::beginEvent,
    &EventNames::beginEventEvent,
    &EventNames::blockedEvent,
    &EventNames::blurEvent,
    &EventNames::boundaryEvent,
    &EventNames::bufferedamountlowEvent,
    &EventNames::bufferedchangeEvent,
    &EventNames::cachedEvent,
    &EventNames::cancelEvent,
    &EventNames::canplayEvent,
    &EventNames::canplaythroughEvent,
    &EventNames::changeEvent,
    &EventNames::chargingchangeEvent,
    &EventNames::chargingtimechangeEvent,
    &EventNames::checkingEvent,
    &EventNames::clickEvent,
    &EventNames::closeEvent,
    &EventNames::closingEvent,
    &EventNames::commandEvent,
    &EventNames::completeEvent,
    &EventNames::compositionendEvent,
    &EventNames::compositionstartEvent,
    &EventNames::compositionupdateEvent,
    &EventNames::configurationchangeEvent,
    &EventNames::connectEvent,
    &EventNames::connectingEvent,
    &EventNames::connectionstatechangeEvent,
    &EventNames::contentvisibilityautostatechangeEvent,
    &EventNames::contextmenuEvent,
    &EventNames::controllerchangeEvent,
    &EventNames::cookiechangeEvent,
    &EventNames::coordinatorstatechangeEvent,
    &EventNames::copyEvent,
#if ENABLE(APPLE_PAY_COUPON_CODE)
    &EventNames::couponcodechangedEvent,
#endif
    &EventNames::cuechangeEvent,
    &EventNames::currententrychangeEvent,
    &EventNames::cutEvent,
    &EventNames::dataavailableEvent,
    &EventNames::datachannelEvent,
    &EventNames::dblclickEvent,
    &EventNames::dequeueEvent,
    &EventNames::devicechangeEvent,
    &EventNames::devicemotionEvent,
    &EventNames::deviceorientationEvent,
    &EventNames::dischargingtimechangeEvent,
    &EventNames::disconnectEvent,
    &EventNames::disposeEvent,
    &EventNames::downloadingEvent,
    &EventNames::dragEvent,
    &EventNames::dragendEvent,
    &EventNames::dragenterEvent,
    &EventNames::dragleaveEvent,
    &EventNames::dragoverEvent,
    &EventNames::dragstartEvent,
    &EventNames::dropEvent,
    &EventNames::durationchangeEvent,
    &EventNames::emptiedEvent,
    &EventNames::encryptedEvent,
    &EventNames::endEvent,
    &EventNames::endEventEvent,
    &EventNames::endedEvent,
    &EventNames::endstreamingEvent,
    &EventNames::enterEvent,
    &EventNames::enterpictureinpictureEvent,
    &EventNames::errorEvent,
    &EventNames::exitEvent,
    &EventNames::fetchEvent,
    &EventNames::finishEvent,
    &EventNames::focusEvent,
    &EventNames::focusinEvent,
    &EventNames::focusoutEvent,
    &EventNames::formdataEvent,
    &EventNames::fullscreenchangeEvent,
    &EventNames::fullscreenerrorEvent,
    &EventNames::gamepadconnectedEvent,
    &EventNames::gamepaddisconnectedEvent,
    &EventNames::gatheringstatechangeEvent,
    &EventNames::gesturechangeEvent,
    &EventNames::gestureendEvent,
    &EventNames::gesturescrollendEvent,
    &EventNames::gesturescrollstartEvent,
    &EventNames::gesturescrollupdateEvent,
    &EventNames::gesturestartEvent,
    &EventNames::gesturetapEvent,
    &EventNames::gesturetapdownEvent,
    &EventNames::gotpointercaptureEvent,
    &EventNames::hashchangeEvent,
    &EventNames::icecandidateEvent,
    &EventNames::icecandidateerrorEvent,
    &EventNames::iceconnectionstatechangeEvent,
    &EventNames::icegatheringstatechangeEvent,
    &EventNames::immersivechangeEvent,
    &EventNames::immersiveerrorEvent,
    &EventNames::inactiveEvent,
    &EventNames::inputEvent,
    &EventNames::inputsourceschangeEvent,
    &EventNames::installEvent,
    &EventNames::invalidEvent,
    &EventNames::keydownEvent,
    &EventNames::keypressEvent,
    &EventNames::keystatuseschangeEvent,
    &EventNames::keyupEvent,
    &EventNames::languagechangeEvent,
    &EventNames::leavepictureinpictureEvent,
    &EventNames::levelchangeEvent,
    &EventNames::loadEvent,
    &EventNames::loadeddataEvent,
    &EventNames::loadedmetadataEvent,
    &EventNames::loadendEvent,
    &EventNames::loadingEvent,
    &EventNames::loadingdoneEvent,
    &EventNames::loadingerrorEvent,
    &EventNames::loadstartEvent,
    &EventNames::lostpointercaptureEvent,
    &EventNames::markEvent,
    &EventNames::merchantvalidationEvent,
    &EventNames::messageEvent,
    &EventNames::messageerrorEvent,
    &EventNames::mousedownEvent,
    &EventNames::mouseenterEvent,
    &EventNames::mouseleaveEvent,
    &EventNames::mousemoveEvent,
    &EventNames::mouseoutEvent,
    &EventNames::mouseoverEvent,
    &EventNames::mouseupEvent,
    &EventNames::mousewheelEvent,
    &EventNames::muteEvent,
    &EventNames::navigateEvent,
    &EventNames::navigateerrorEvent,
    &EventNames::navigatesuccessEvent,
    &EventNames::negotiationneededEvent,
    &EventNames::nexttrackEvent,
    &EventNames::nomatchEvent,
    &EventNames::notificationclickEvent,
    &EventNames::notificationcloseEvent,
    &EventNames::noupdateEvent,
    &EventNames::obsoleteEvent,
    &EventNames::offlineEvent,
    &EventNames::onlineEvent,
    &EventNames::openEvent,
    &EventNames::orientationchangeEvent,
    &EventNames::pagehideEvent,
    &EventNames::pagerevealEvent,
    &EventNames::pageshowEvent,
    &EventNames::pageswapEvent,
    &EventNames::paintEvent,
    &EventNames::pasteEvent,
    &EventNames::pauseEvent,
    &EventNames::payerdetailchangeEvent,
    &EventNames::paymentauthorizedEvent,
    &EventNames::paymentmethodchangeEvent,
    &EventNames::paymentmethodselectedEvent,
    &EventNames::playEvent,
    &EventNames::playingEvent,
    &EventNames::pointercancelEvent,
    &EventNames::pointerdownEvent,
    &EventNames::pointerenterEvent,
    &EventNames::pointerleaveEvent,
    &EventNames::pointerlockchangeEvent,
    &EventNames::pointerlockerrorEvent,
    &EventNames::pointermoveEvent,
    &EventNames::pointeroutEvent,
    &EventNames::pointeroverEvent,
    &EventNames::pointerupEvent,
    &EventNames::popstateEvent,
    &EventNames::previoustrackEvent,
    &EventNames::processorerrorEvent,
    &EventNames::progressEvent,
    &EventNames::pushEvent,
    &EventNames::pushsubscriptionchangeEvent,
    &EventNames::qualitychangeEvent,
    &EventNames::ratechangeEvent,
    &EventNames::readystatechangeEvent,
    &EventNames::redrawEvent,
    &EventNames::rejectionhandledEvent,
    &EventNames::releaseEvent,
    &EventNames::removeEvent,
    &EventNames::removesourcebufferEvent,
    &EventNames::removestreamEvent,
    &EventNames::removetrackEvent,
    &EventNames::repeatEvent,
    &EventNames::repeatEventEvent,
    &EventNames::resetEvent,
    &EventNames::resizeEvent,
    &EventNames::resourcetimingbufferfullEvent,
    &EventNames::resultEvent,
    &EventNames::resumeEvent,
    &EventNames::rtctransformEvent,
    &EventNames::scrollEvent,
    &EventNames::scrollendEvent,
    &EventNames::securitypolicyviolationEvent,
    &EventNames::seekedEvent,
    &EventNames::seekingEvent,
    &EventNames::selectEvent,
    &EventNames::selectedcandidatepairchangeEvent,
    &EventNames::selectendEvent,
    &EventNames::selectionchangeEvent,
    &EventNames::selectstartEvent,
    &EventNames::shippingaddresschangeEvent,
    &EventNames::shippingcontactselectedEvent,
    &EventNames::shippingmethodselectedEvent,
    &EventNames::shippingoptionchangeEvent,
    &EventNames::showEvent,
    &EventNames::signalingstatechangeEvent,
    &EventNames::slotchangeEvent,
    &EventNames::soundendEvent,
    &EventNames::soundstartEvent,
    &EventNames::sourcecloseEvent,
    &EventNames::sourceendedEvent,
    &EventNames::sourceopenEvent,
    &EventNames::speechendEvent,
    &EventNames::speechstartEvent,
    &EventNames::squeezeEvent,
    &EventNames::squeezeendEvent,
    &EventNames::squeezestartEvent,
    &EventNames::stalledEvent,
    &EventNames::startEvent,
    &EventNames::startedEvent,
    &EventNames::startstreamingEvent,
    &EventNames::statechangeEvent,
    &EventNames::stopEvent,
    &EventNames::storageEvent,
    &EventNames::submitEvent,
    &EventNames::successEvent,
    &EventNames::suspendEvent,
    &EventNames::textInputEvent,
    &EventNames::timeoutEvent,
    &EventNames::timeupdateEvent,
    &EventNames::toggleEvent,
    &EventNames::tonechangeEvent,
    &EventNames::touchcancelEvent,
    &EventNames::touchendEvent,
    &EventNames::touchforcechangeEvent,
    &EventNames::touchmoveEvent,
    &EventNames::touchstartEvent,
    &EventNames::trackEvent,
    &EventNames::transitioncancelEvent,
    &EventNames::transitionendEvent,
    &EventNames::transitionrunEvent,
    &EventNames::transitionstartEvent,
    &EventNames::uncapturederrorEvent,
    &EventNames::unhandledrejectionEvent,
    &EventNames::unloadEvent,
    &EventNames::unmuteEvent,
    &EventNames::updateEvent,
    &EventNames::updateendEvent,
    &EventNames::updatefoundEvent,
    &EventNames::updatereadyEvent,
    &EventNames::updatestartEvent,
    &EventNames::upgradeneededEvent,
    &EventNames::validatemerchantEvent,
    &EventNames::versionchangeEvent,
    &EventNames::visibilitychangeEvent,
    &EventNames::voiceschangedEvent,
    &EventNames::volumechangeEvent,
    &EventNames::waitingEvent,
    &EventNames::waitingforkeyEvent,
    &EventNames::webglcontextcreationerrorEvent,
    &EventNames::webglcontextlostEvent,
    &EventNames::webglcontextrestoredEvent,
    &EventNames::webkitAnimationEndEvent,
    &EventNames::webkitAnimationIterationEvent,
    &EventNames::webkitAnimationStartEvent,
    &EventNames::webkitBeforeTextInsertedEvent,
    &EventNames::webkitTransitionEndEvent,
    &EventNames::webkitassociateformcontrolsEvent,
    &EventNames::webkitautofillrequestEvent,
    &EventNames::webkitbeforeblurEvent,
    &EventNames::webkitbeforefocusEvent,
    &EventNames::webkitbeginfullscreenEvent,
    &EventNames::webkitcameramovedEvent,
    &EventNames::webkitcameraviewchangedEvent,
    &EventNames::webkitcurrentplaybacktargetiswirelesschangedEvent,
    &EventNames::webkitendfullscreenEvent,
    &EventNames::webkitexternalplaybackchangedEvent,
    &EventNames::webkitfocusedelementdisconnectedEvent,
    &EventNames::webkitfullscreenchangeEvent,
    &EventNames::webkitfullscreenerrorEvent,
    &EventNames::webkitkeyaddedEvent,
    &EventNames::webkitkeyerrorEvent,
    &EventNames::webkitkeymessageEvent,
    &EventNames::webkitmediasessionmetadatachangedEvent,
    &EventNames::webkitmouseforcechangedEvent,
    &EventNames::webkitmouseforcedownEvent,
    &EventNames::webkitmouseforceupEvent,
    &EventNames::webkitmouseforcewillbeginEvent,
    &EventNames::webkitneedkeyEvent,
    &EventNames::webkitnetworkinfochangeEvent,
    &EventNames::webkitplaybacktargetavailabilitychangedEvent,
    &EventNames::webkitpresentationmodechangedEvent,
    &EventNames::webkitprojectionchangedEvent,
    &EventNames::webkitremovesourcebufferEvent,
    &EventNames::webkitsourcecloseEvent,
    &EventNames::webkitsourceendedEvent,
    &EventNames::webkitsourceopenEvent,
    &EventNames::webkitsubmitEvent,
    &EventNames::webkitusertextinputEvent,
    &EventNames::wheelEvent,
    &EventNames::writeEvent,
    &EventNames::writeendEvent,
    &EventNames::writestartEvent,
    &EventNames::zoomEvent,
};

const AtomString& EventNames::eventNameFromEventType(EventType type) const
{
    auto typeAsIndex = static_cast<size_t>(type) - 1;
    return this->*(eventStringInEventNames[typeAsIndex]);
}

thread_local std::unique_ptr<EventNames> eventNames_;

const EventNames& eventNames()
{
    if (!eventNames_)
        eventNames_ = EventNames::create();
    return *eventNames_;
}

enum class DOMEventName : uint8_t {
    rename = 0,
    change = 1,
    error = 2,
    abort = 3,
    close = 4,

};

extern "C" JSC::EncodedJSValue Bun__domEventNameToJS(JSC::JSGlobalObject* globalObject, DOMEventName name)
{
    const auto& eventName = [&]() -> const AtomString& {
        switch (name) {
        case DOMEventName::rename:
            return eventNames().renameEvent;
        case DOMEventName::change:
            return eventNames().changeEvent;
        case DOMEventName::error:
            return eventNames().errorEvent;
        case DOMEventName::abort:
            return eventNames().abortEvent;
        case DOMEventName::close:
            return eventNames().closeEvent;
        default:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }();

    return JSC::JSValue::encode(JSC::jsString(globalObject->vm(), eventName));
}

} // namespace WebCore
