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

#include "config.h"
#include "EventHeaders.h"
#include "JSDOMWrapperCache.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/StructureInlines.h>

namespace WebCore {

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Event>&& impl)
{
    switch (impl->eventInterface()) {
        //     case AnimationEventInterfaceType:
        //         return createWrapper<AnimationEvent>(globalObject, WTFMove(impl));
        //     case AnimationPlaybackEventInterfaceType:
        //         return createWrapper<AnimationPlaybackEvent>(globalObject, WTFMove(impl));
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayCancelEventInterfaceType:
        //         return createWrapper<ApplePayCancelEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(APPLE_PAY_COUPON_CODE)
        //     case ApplePayCouponCodeChangedEventInterfaceType:
        //         return createWrapper<ApplePayCouponCodeChangedEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayPaymentAuthorizedEventInterfaceType:
        //         return createWrapper<ApplePayPaymentAuthorizedEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayPaymentMethodSelectedEventInterfaceType:
        //         return createWrapper<ApplePayPaymentMethodSelectedEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayShippingContactSelectedEventInterfaceType:
        //         return createWrapper<ApplePayShippingContactSelectedEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayShippingMethodSelectedEventInterfaceType:
        //         return createWrapper<ApplePayShippingMethodSelectedEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayValidateMerchantEventInterfaceType:
        //         return createWrapper<ApplePayValidateMerchantEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(WEB_AUDIO)
        //     case AudioProcessingEventInterfaceType:
        //         return createWrapper<AudioProcessingEvent>(globalObject, WTFMove(impl));
        // #endif
    case EventInterfaceType: {
        return createWrapper<Event>(globalObject, WTFMove(impl));
    }
        //     case BeforeUnloadEventInterfaceType:
        //         return createWrapper<BeforeUnloadEvent>(globalObject, WTFMove(impl));
        // #if ENABLE(MEDIA_RECORDER)
        //     case BlobEventInterfaceType:
        //         return createWrapper<BlobEvent>(globalObject, WTFMove(impl));
        // #endif
        //     case ClipboardEventInterfaceType:
        //         return createWrapper<ClipboardEvent>(globalObject, WTFMove(impl));
    case CloseEventInterfaceType: {
        return createWrapper<CloseEvent>(globalObject, WTFMove(impl));
    }
    //     case CompositionEventInterfaceType:
    //         return createWrapper<CompositionEvent>(globalObject, WTFMove(impl));
    //     case CustomEventInterfaceType:
    //         return createWrapper<CustomEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(DEVICE_ORIENTATION)
    //     case DeviceMotionEventInterfaceType:
    //         return createWrapper<DeviceMotionEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(DEVICE_ORIENTATION)
    //     case DeviceOrientationEventInterfaceType:
    //         return createWrapper<DeviceOrientationEvent>(globalObject, WTFMove(impl));
    // #endif
    //     case DragEventInterfaceType:
    //         return createWrapper<DragEvent>(globalObject, WTFMove(impl));
    case ErrorEventInterfaceType: {
        return createWrapper<ErrorEvent>(globalObject, WTFMove(impl));
    }
        // #if ENABLE(SERVICE_WORKER)
        //     case ExtendableEventInterfaceType:
        //         return createWrapper<ExtendableEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case ExtendableMessageEventInterfaceType:
        //         return createWrapper<ExtendableMessageEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case FetchEventInterfaceType:
        //         return createWrapper<FetchEvent>(globalObject, WTFMove(impl));
        // #endif
        //     case FocusEventInterfaceType:
        //         return createWrapper<FocusEvent>(globalObject, WTFMove(impl));
        //     case FormDataEventInterfaceType:
        //         return createWrapper<FormDataEvent>(globalObject, WTFMove(impl));
        // #if ENABLE(GAMEPAD)
        //     case GamepadEventInterfaceType:
        //         return createWrapper<GamepadEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(IOS_GESTURE_EVENTS) || ENABLE(MAC_GESTURE_EVENTS)
        //     case GestureEventInterfaceType:
        //         return createWrapper<GestureEvent>(globalObject, WTFMove(impl));
        // #endif
        //     case HashChangeEventInterfaceType:
        //         return createWrapper<HashChangeEvent>(globalObject, WTFMove(impl));
        //     case IDBVersionChangeEventInterfaceType:
        //         return createWrapper<IDBVersionChangeEvent>(globalObject, WTFMove(impl));
        //     case InputEventInterfaceType:
        //         return createWrapper<InputEvent>(globalObject, WTFMove(impl));
        //     case KeyboardEventInterfaceType:
        //         return createWrapper<KeyboardEvent>(globalObject, WTFMove(impl));
        // #if ENABLE(ENCRYPTED_MEDIA)
        //     case MediaEncryptedEventInterfaceType:
        //         return createWrapper<MediaEncryptedEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(ENCRYPTED_MEDIA)
        //     case MediaKeyMessageEventInterfaceType:
        //         return createWrapper<MediaKeyMessageEvent>(globalObject, WTFMove(impl));
        // #endif
        //     case MediaQueryListEventInterfaceType:
        //         return createWrapper<MediaQueryListEvent>(globalObject, WTFMove(impl));
        // #if ENABLE(MEDIA_RECORDER)
        //     case MediaRecorderErrorEventInterfaceType:
        //         return createWrapper<MediaRecorderErrorEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(MEDIA_STREAM)
        //     case MediaStreamTrackEventInterfaceType:
        //         return createWrapper<MediaStreamTrackEvent>(globalObject, WTFMove(impl));
        // #endif
        // #if ENABLE(PAYMENT_REQUEST)
        //     case MerchantValidationEventInterfaceType:
        //         return createWrapper<MerchantValidationEvent>(globalObject, WTFMove(impl));
        // #endif
    case MessageEventInterfaceType:
        return createWrapper<MessageEvent>(globalObject, WTFMove(impl));
    //     case MouseEventInterfaceType:
    //         return createWrapper<MouseEvent>(globalObject, WTFMove(impl));
    //     case MutationEventInterfaceType:
    //         return createWrapper<MutationEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(NOTIFICATION_EVENT)
    //     case NotificationEventInterfaceType:
    //         return createWrapper<NotificationEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_AUDIO)
    //     case OfflineAudioCompletionEventInterfaceType:
    //         return createWrapper<OfflineAudioCompletionEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(MEDIA_STREAM)
    //     case OverconstrainedErrorEventInterfaceType:
    //         return createWrapper<OverconstrainedErrorEvent>(globalObject, WTFMove(impl));
    // #endif
    //     case OverflowEventInterfaceType:
    //         return createWrapper<OverflowEvent>(globalObject, WTFMove(impl));
    //     case PageTransitionEventInterfaceType:
    //         return createWrapper<PageTransitionEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(PAYMENT_REQUEST)
    //     case PaymentMethodChangeEventInterfaceType:
    //         return createWrapper<PaymentMethodChangeEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(PAYMENT_REQUEST)
    //     case PaymentRequestUpdateEventInterfaceType:
    //         return createWrapper<PaymentRequestUpdateEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(PICTURE_IN_PICTURE_API)
    //     case PictureInPictureEventInterfaceType:
    //         return createWrapper<PictureInPictureEvent>(globalObject, WTFMove(impl));
    // #endif
    //     case PointerEventInterfaceType:
    //         return createWrapper<PointerEvent>(globalObject, WTFMove(impl));
    //     case PopStateEventInterfaceType:
    //         return createWrapper<PopStateEvent>(globalObject, WTFMove(impl));
    //     case ProgressEventInterfaceType:
    //         return createWrapper<ProgressEvent>(globalObject, WTFMove(impl));
    //     case PromiseRejectionEventInterfaceType:
    //         return createWrapper<PromiseRejectionEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(SERVICE_WORKER)
    //     case PushEventInterfaceType:
    //         return createWrapper<PushEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(SERVICE_WORKER)
    //     case PushSubscriptionChangeEventInterfaceType:
    //         return createWrapper<PushSubscriptionChangeEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCDTMFToneChangeEventInterfaceType:
    //         return createWrapper<RTCDTMFToneChangeEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCDataChannelEventInterfaceType:
    //         return createWrapper<RTCDataChannelEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCErrorEventInterfaceType:
    //         return createWrapper<RTCErrorEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCPeerConnectionIceErrorEventInterfaceType:
    //         return createWrapper<RTCPeerConnectionIceErrorEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCPeerConnectionIceEventInterfaceType:
    //         return createWrapper<RTCPeerConnectionIceEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCRtpSFrameTransformErrorEventInterfaceType:
    //         return createWrapper<RTCRtpSFrameTransformErrorEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCTrackEventInterfaceType:
    //         return createWrapper<RTCTrackEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCTransformEventInterfaceType:
    //         return createWrapper<RTCTransformEvent>(globalObject, WTFMove(impl));
    // #endif
    //     case SVGZoomEventInterfaceType:
    //         return createWrapper<SVGZoomEvent>(globalObject, WTFMove(impl));
    //     case SecurityPolicyViolationEventInterfaceType:
    //         return createWrapper<SecurityPolicyViolationEvent>(globalObject, WTFMove(impl));
    //     case SpeechRecognitionErrorEventInterfaceType:
    //         return createWrapper<SpeechRecognitionErrorEvent>(globalObject, WTFMove(impl));
    //     case SpeechRecognitionEventInterfaceType:
    //         return createWrapper<SpeechRecognitionEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(SPEECH_SYNTHESIS)
    //     case SpeechSynthesisErrorEventInterfaceType:
    //         return createWrapper<SpeechSynthesisErrorEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(SPEECH_SYNTHESIS)
    //     case SpeechSynthesisEventInterfaceType:
    //         return createWrapper<SpeechSynthesisEvent>(globalObject, WTFMove(impl));
    // #endif
    //     case StorageEventInterfaceType:
    //         return createWrapper<StorageEvent>(globalObject, WTFMove(impl));
    //     case SubmitEventInterfaceType:
    //         return createWrapper<SubmitEvent>(globalObject, WTFMove(impl));
    //     case TextEventInterfaceType:
    //         return createWrapper<TextEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(TOUCH_EVENTS)
    //     case TouchEventInterfaceType:
    //         return createWrapper<TouchEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(VIDEO)
    //     case TrackEventInterfaceType:
    //         return createWrapper<TrackEvent>(globalObject, WTFMove(impl));
    // #endif
    //     case TransitionEventInterfaceType:
    //         return createWrapper<TransitionEvent>(globalObject, WTFMove(impl));
    //     case UIEventInterfaceType:
    //         return createWrapper<UIEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(WEBGL)
    //     case WebGLContextEventInterfaceType:
    //         return createWrapper<WebGLContextEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(LEGACY_ENCRYPTED_MEDIA)
    //     case WebKitMediaKeyMessageEventInterfaceType:
    //         return createWrapper<WebKitMediaKeyMessageEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(LEGACY_ENCRYPTED_MEDIA)
    //     case WebKitMediaKeyNeededEventInterfaceType:
    //         return createWrapper<WebKitMediaKeyNeededEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WIRELESS_PLAYBACK_TARGET)
    //     case WebKitPlaybackTargetAvailabilityEventInterfaceType:
    //         return createWrapper<WebKitPlaybackTargetAvailabilityEvent>(globalObject, WTFMove(impl));
    // #endif
    //     case WheelEventInterfaceType:
    //         return createWrapper<WheelEvent>(globalObject, WTFMove(impl));
    //     case XMLHttpRequestProgressEventInterfaceType:
    //         return createWrapper<XMLHttpRequestProgressEvent>(globalObject, WTFMove(impl));
    // #if ENABLE(WEBXR)
    //     case XRInputSourceEventInterfaceType:
    //         return createWrapper<XRInputSourceEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEBXR)
    //     case XRInputSourcesChangeEventInterfaceType:
    //         return createWrapper<XRInputSourcesChangeEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEBXR)
    //     case XRReferenceSpaceEventInterfaceType:
    //         return createWrapper<XRReferenceSpaceEvent>(globalObject, WTFMove(impl));
    // #endif
    // #if ENABLE(WEBXR)
    //     case XRSessionEventInterfaceType:
    //         return createWrapper<XRSessionEvent>(globalObject, WTFMove(impl));
    // #endif
    //     }
    default: {
        break;
    }
    }

    return createWrapper<Event>(globalObject, WTFMove(impl));
}

} // namespace WebCore
