/*
 * THIS FILE WAS AUTOMATICALLY GENERATED, DO NOT EDIT.
 *
 * Copyright (C) 2011 Google Inc.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY GOOGLE, INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

namespace WebCore {

enum EventInterface {
#if ENABLE(APPLE_PAY)
    ApplePayCancelEventInterfaceType = 1,
    ApplePayPaymentAuthorizedEventInterfaceType = 2,
    ApplePayPaymentMethodSelectedEventInterfaceType = 3,
    ApplePayShippingContactSelectedEventInterfaceType = 4,
    ApplePayShippingMethodSelectedEventInterfaceType = 5,
    ApplePayValidateMerchantEventInterfaceType = 6,
#endif
#if ENABLE(APPLE_PAY_COUPON_CODE)
    ApplePayCouponCodeChangedEventInterfaceType = 7,
#endif
#if ENABLE(DEVICE_ORIENTATION)
    DeviceMotionEventInterfaceType = 8,
    DeviceOrientationEventInterfaceType = 9,
#endif
#if ENABLE(ENCRYPTED_MEDIA)
    MediaEncryptedEventInterfaceType = 10,
    MediaKeyMessageEventInterfaceType = 11,
#endif
#if ENABLE(GAMEPAD)
    GamepadEventInterfaceType = 12,
#endif
#if ENABLE(IOS_GESTURE_EVENTS) || ENABLE(MAC_GESTURE_EVENTS)
    GestureEventInterfaceType = 13,
#endif
#if ENABLE(LEGACY_ENCRYPTED_MEDIA)
    WebKitMediaKeyMessageEventInterfaceType = 14,
    WebKitMediaKeyNeededEventInterfaceType = 15,
#endif
#if ENABLE(MEDIA_RECORDER)
    BlobEventInterfaceType = 16,
    MediaRecorderErrorEventInterfaceType = 17,
#endif
#if ENABLE(MEDIA_STREAM)
    MediaStreamTrackEventInterfaceType = 18,
    OverconstrainedErrorEventInterfaceType = 19,
#endif
#if ENABLE(NOTIFICATION_EVENT)
    NotificationEventInterfaceType = 20,
#endif
#if ENABLE(ORIENTATION_EVENTS)
#endif
#if ENABLE(PAYMENT_REQUEST)
    MerchantValidationEventInterfaceType = 21,
    PaymentMethodChangeEventInterfaceType = 22,
    PaymentRequestUpdateEventInterfaceType = 23,
#endif
#if ENABLE(PICTURE_IN_PICTURE_API)
    PictureInPictureEventInterfaceType = 24,
#endif
#if ENABLE(SERVICE_WORKER)
    ExtendableEventInterfaceType = 25,
    ExtendableMessageEventInterfaceType = 26,
    FetchEventInterfaceType = 27,
    PushEventInterfaceType = 28,
    PushSubscriptionChangeEventInterfaceType = 29,
#endif
#if ENABLE(SPEECH_SYNTHESIS)
    SpeechSynthesisErrorEventInterfaceType = 30,
    SpeechSynthesisEventInterfaceType = 31,
#endif
#if ENABLE(TOUCH_EVENTS)
    TouchEventInterfaceType = 32,
#endif
#if ENABLE(VIDEO)
    TrackEventInterfaceType = 33,
#endif
#if ENABLE(WEBGL)
    WebGLContextEventInterfaceType = 34,
#endif
#if ENABLE(WEBXR)
    XRInputSourceEventInterfaceType = 35,
    XRInputSourcesChangeEventInterfaceType = 36,
    XRReferenceSpaceEventInterfaceType = 37,
    XRSessionEventInterfaceType = 38,
#endif
#if ENABLE(WEB_AUDIO)
    AudioProcessingEventInterfaceType = 39,
    OfflineAudioCompletionEventInterfaceType = 40,
#endif
#if ENABLE(WEB_RTC)
    RTCDTMFToneChangeEventInterfaceType = 41,
    RTCDataChannelEventInterfaceType = 42,
    RTCErrorEventInterfaceType = 43,
    RTCPeerConnectionIceErrorEventInterfaceType = 44,
    RTCPeerConnectionIceEventInterfaceType = 45,
    RTCRtpSFrameTransformErrorEventInterfaceType = 46,
    RTCTrackEventInterfaceType = 47,
    RTCTransformEventInterfaceType = 48,
#endif
#if ENABLE(WIRELESS_PLAYBACK_TARGET)
    WebKitPlaybackTargetAvailabilityEventInterfaceType = 49,
#endif
    AnimationEventInterfaceType = 50,
    AnimationPlaybackEventInterfaceType = 51,
    BeforeUnloadEventInterfaceType = 52,
    ClipboardEventInterfaceType = 53,
    CloseEventInterfaceType = 54,
    CompositionEventInterfaceType = 55,
    CustomEventInterfaceType = 56,
    DragEventInterfaceType = 57,
    ErrorEventInterfaceType = 58,
    EventInterfaceType = 59,
    FocusEventInterfaceType = 60,
    FormDataEventInterfaceType = 61,
    HashChangeEventInterfaceType = 62,
    IDBVersionChangeEventInterfaceType = 63,
    InputEventInterfaceType = 64,
    KeyboardEventInterfaceType = 65,
    MediaQueryListEventInterfaceType = 66,
    MessageEventInterfaceType = 67,
    MouseEventInterfaceType = 68,
    MutationEventInterfaceType = 69,
    OverflowEventInterfaceType = 70,
    PageTransitionEventInterfaceType = 71,
    PointerEventInterfaceType = 72,
    PopStateEventInterfaceType = 73,
    ProgressEventInterfaceType = 74,
    PromiseRejectionEventInterfaceType = 75,
    SVGZoomEventInterfaceType = 76,
    SecurityPolicyViolationEventInterfaceType = 77,
    SpeechRecognitionErrorEventInterfaceType = 78,
    SpeechRecognitionEventInterfaceType = 79,
    StorageEventInterfaceType = 80,
    SubmitEventInterfaceType = 81,
    TextEventInterfaceType = 82,
    TransitionEventInterfaceType = 83,
    UIEventInterfaceType = 84,
    WheelEventInterfaceType = 85,
    XMLHttpRequestProgressEventInterfaceType = 86,
};

} // namespace WebCore
