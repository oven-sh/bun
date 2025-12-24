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
        //         return createWrapper<AnimationEvent>(globalObject, std::move(impl));
        //     case AnimationPlaybackEventInterfaceType:
        //         return createWrapper<AnimationPlaybackEvent>(globalObject, std::move(impl));
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayCancelEventInterfaceType:
        //         return createWrapper<ApplePayCancelEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(APPLE_PAY_COUPON_CODE)
        //     case ApplePayCouponCodeChangedEventInterfaceType:
        //         return createWrapper<ApplePayCouponCodeChangedEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayPaymentAuthorizedEventInterfaceType:
        //         return createWrapper<ApplePayPaymentAuthorizedEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayPaymentMethodSelectedEventInterfaceType:
        //         return createWrapper<ApplePayPaymentMethodSelectedEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayShippingContactSelectedEventInterfaceType:
        //         return createWrapper<ApplePayShippingContactSelectedEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayShippingMethodSelectedEventInterfaceType:
        //         return createWrapper<ApplePayShippingMethodSelectedEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(APPLE_PAY)
        //     case ApplePayValidateMerchantEventInterfaceType:
        //         return createWrapper<ApplePayValidateMerchantEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(WEB_AUDIO)
        //     case AudioProcessingEventInterfaceType:
        //         return createWrapper<AudioProcessingEvent>(globalObject, std::move(impl));
        // #endif
    case EventInterfaceType: {
        return createWrapper<Event>(globalObject, std::move(impl));
    }
        //     case BeforeUnloadEventInterfaceType:
        //         return createWrapper<BeforeUnloadEvent>(globalObject, std::move(impl));
        // #if ENABLE(MEDIA_RECORDER)
        //     case BlobEventInterfaceType:
        //         return createWrapper<BlobEvent>(globalObject, std::move(impl));
        // #endif
        //     case ClipboardEventInterfaceType:
        //         return createWrapper<ClipboardEvent>(globalObject, std::move(impl));
    case CloseEventInterfaceType: {
        return createWrapper<CloseEvent>(globalObject, std::move(impl));
    }
    //     case CompositionEventInterfaceType:
    //         return createWrapper<CompositionEvent>(globalObject, std::move(impl));
    //     case CustomEventInterfaceType:
    //         return createWrapper<CustomEvent>(globalObject, std::move(impl));
    // #if ENABLE(DEVICE_ORIENTATION)
    //     case DeviceMotionEventInterfaceType:
    //         return createWrapper<DeviceMotionEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(DEVICE_ORIENTATION)
    //     case DeviceOrientationEventInterfaceType:
    //         return createWrapper<DeviceOrientationEvent>(globalObject, std::move(impl));
    // #endif
    //     case DragEventInterfaceType:
    //         return createWrapper<DragEvent>(globalObject, std::move(impl));
    case ErrorEventInterfaceType: {
        return createWrapper<ErrorEvent>(globalObject, std::move(impl));
    }
        // #if ENABLE(SERVICE_WORKER)
        //     case ExtendableEventInterfaceType:
        //         return createWrapper<ExtendableEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case ExtendableMessageEventInterfaceType:
        //         return createWrapper<ExtendableMessageEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case FetchEventInterfaceType:
        //         return createWrapper<FetchEvent>(globalObject, std::move(impl));
        // #endif
        //     case FocusEventInterfaceType:
        //         return createWrapper<FocusEvent>(globalObject, std::move(impl));
        //     case FormDataEventInterfaceType:
        //         return createWrapper<FormDataEvent>(globalObject, std::move(impl));
        // #if ENABLE(GAMEPAD)
        //     case GamepadEventInterfaceType:
        //         return createWrapper<GamepadEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(IOS_GESTURE_EVENTS) || ENABLE(MAC_GESTURE_EVENTS)
        //     case GestureEventInterfaceType:
        //         return createWrapper<GestureEvent>(globalObject, std::move(impl));
        // #endif
        //     case HashChangeEventInterfaceType:
        //         return createWrapper<HashChangeEvent>(globalObject, std::move(impl));
        //     case IDBVersionChangeEventInterfaceType:
        //         return createWrapper<IDBVersionChangeEvent>(globalObject, std::move(impl));
        //     case InputEventInterfaceType:
        //         return createWrapper<InputEvent>(globalObject, std::move(impl));
        //     case KeyboardEventInterfaceType:
        //         return createWrapper<KeyboardEvent>(globalObject, std::move(impl));
        // #if ENABLE(ENCRYPTED_MEDIA)
        //     case MediaEncryptedEventInterfaceType:
        //         return createWrapper<MediaEncryptedEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(ENCRYPTED_MEDIA)
        //     case MediaKeyMessageEventInterfaceType:
        //         return createWrapper<MediaKeyMessageEvent>(globalObject, std::move(impl));
        // #endif
        //     case MediaQueryListEventInterfaceType:
        //         return createWrapper<MediaQueryListEvent>(globalObject, std::move(impl));
        // #if ENABLE(MEDIA_RECORDER)
        //     case MediaRecorderErrorEventInterfaceType:
        //         return createWrapper<MediaRecorderErrorEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(MEDIA_STREAM)
        //     case MediaStreamTrackEventInterfaceType:
        //         return createWrapper<MediaStreamTrackEvent>(globalObject, std::move(impl));
        // #endif
        // #if ENABLE(PAYMENT_REQUEST)
        //     case MerchantValidationEventInterfaceType:
        //         return createWrapper<MerchantValidationEvent>(globalObject, std::move(impl));
        // #endif
    case MessageEventInterfaceType:
        return createWrapper<MessageEvent>(globalObject, std::move(impl));
    //     case MouseEventInterfaceType:
    //         return createWrapper<MouseEvent>(globalObject, std::move(impl));
    //     case MutationEventInterfaceType:
    //         return createWrapper<MutationEvent>(globalObject, std::move(impl));
    // #if ENABLE(NOTIFICATION_EVENT)
    //     case NotificationEventInterfaceType:
    //         return createWrapper<NotificationEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_AUDIO)
    //     case OfflineAudioCompletionEventInterfaceType:
    //         return createWrapper<OfflineAudioCompletionEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(MEDIA_STREAM)
    //     case OverconstrainedErrorEventInterfaceType:
    //         return createWrapper<OverconstrainedErrorEvent>(globalObject, std::move(impl));
    // #endif
    //     case OverflowEventInterfaceType:
    //         return createWrapper<OverflowEvent>(globalObject, std::move(impl));
    //     case PageTransitionEventInterfaceType:
    //         return createWrapper<PageTransitionEvent>(globalObject, std::move(impl));
    // #if ENABLE(PAYMENT_REQUEST)
    //     case PaymentMethodChangeEventInterfaceType:
    //         return createWrapper<PaymentMethodChangeEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(PAYMENT_REQUEST)
    //     case PaymentRequestUpdateEventInterfaceType:
    //         return createWrapper<PaymentRequestUpdateEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(PICTURE_IN_PICTURE_API)
    //     case PictureInPictureEventInterfaceType:
    //         return createWrapper<PictureInPictureEvent>(globalObject, std::move(impl));
    // #endif
    //     case PointerEventInterfaceType:
    //         return createWrapper<PointerEvent>(globalObject, std::move(impl));
    //     case PopStateEventInterfaceType:
    //         return createWrapper<PopStateEvent>(globalObject, std::move(impl));
    //     case ProgressEventInterfaceType:
    //         return createWrapper<ProgressEvent>(globalObject, std::move(impl));
    //     case PromiseRejectionEventInterfaceType:
    //         return createWrapper<PromiseRejectionEvent>(globalObject, std::move(impl));
    // #if ENABLE(SERVICE_WORKER)
    //     case PushEventInterfaceType:
    //         return createWrapper<PushEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(SERVICE_WORKER)
    //     case PushSubscriptionChangeEventInterfaceType:
    //         return createWrapper<PushSubscriptionChangeEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCDTMFToneChangeEventInterfaceType:
    //         return createWrapper<RTCDTMFToneChangeEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCDataChannelEventInterfaceType:
    //         return createWrapper<RTCDataChannelEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCErrorEventInterfaceType:
    //         return createWrapper<RTCErrorEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCPeerConnectionIceErrorEventInterfaceType:
    //         return createWrapper<RTCPeerConnectionIceErrorEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCPeerConnectionIceEventInterfaceType:
    //         return createWrapper<RTCPeerConnectionIceEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCRtpSFrameTransformErrorEventInterfaceType:
    //         return createWrapper<RTCRtpSFrameTransformErrorEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCTrackEventInterfaceType:
    //         return createWrapper<RTCTrackEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEB_RTC)
    //     case RTCTransformEventInterfaceType:
    //         return createWrapper<RTCTransformEvent>(globalObject, std::move(impl));
    // #endif
    //     case SVGZoomEventInterfaceType:
    //         return createWrapper<SVGZoomEvent>(globalObject, std::move(impl));
    //     case SecurityPolicyViolationEventInterfaceType:
    //         return createWrapper<SecurityPolicyViolationEvent>(globalObject, std::move(impl));
    //     case SpeechRecognitionErrorEventInterfaceType:
    //         return createWrapper<SpeechRecognitionErrorEvent>(globalObject, std::move(impl));
    //     case SpeechRecognitionEventInterfaceType:
    //         return createWrapper<SpeechRecognitionEvent>(globalObject, std::move(impl));
    // #if ENABLE(SPEECH_SYNTHESIS)
    //     case SpeechSynthesisErrorEventInterfaceType:
    //         return createWrapper<SpeechSynthesisErrorEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(SPEECH_SYNTHESIS)
    //     case SpeechSynthesisEventInterfaceType:
    //         return createWrapper<SpeechSynthesisEvent>(globalObject, std::move(impl));
    // #endif
    //     case StorageEventInterfaceType:
    //         return createWrapper<StorageEvent>(globalObject, std::move(impl));
    //     case SubmitEventInterfaceType:
    //         return createWrapper<SubmitEvent>(globalObject, std::move(impl));
    //     case TextEventInterfaceType:
    //         return createWrapper<TextEvent>(globalObject, std::move(impl));
    // #if ENABLE(TOUCH_EVENTS)
    //     case TouchEventInterfaceType:
    //         return createWrapper<TouchEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(VIDEO)
    //     case TrackEventInterfaceType:
    //         return createWrapper<TrackEvent>(globalObject, std::move(impl));
    // #endif
    //     case TransitionEventInterfaceType:
    //         return createWrapper<TransitionEvent>(globalObject, std::move(impl));
    //     case UIEventInterfaceType:
    //         return createWrapper<UIEvent>(globalObject, std::move(impl));
    // #if ENABLE(WEBGL)
    //     case WebGLContextEventInterfaceType:
    //         return createWrapper<WebGLContextEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(LEGACY_ENCRYPTED_MEDIA)
    //     case WebKitMediaKeyMessageEventInterfaceType:
    //         return createWrapper<WebKitMediaKeyMessageEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(LEGACY_ENCRYPTED_MEDIA)
    //     case WebKitMediaKeyNeededEventInterfaceType:
    //         return createWrapper<WebKitMediaKeyNeededEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WIRELESS_PLAYBACK_TARGET)
    //     case WebKitPlaybackTargetAvailabilityEventInterfaceType:
    //         return createWrapper<WebKitPlaybackTargetAvailabilityEvent>(globalObject, std::move(impl));
    // #endif
    //     case WheelEventInterfaceType:
    //         return createWrapper<WheelEvent>(globalObject, std::move(impl));
    //     case XMLHttpRequestProgressEventInterfaceType:
    //         return createWrapper<XMLHttpRequestProgressEvent>(globalObject, std::move(impl));
    // #if ENABLE(WEBXR)
    //     case XRInputSourceEventInterfaceType:
    //         return createWrapper<XRInputSourceEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEBXR)
    //     case XRInputSourcesChangeEventInterfaceType:
    //         return createWrapper<XRInputSourcesChangeEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEBXR)
    //     case XRReferenceSpaceEventInterfaceType:
    //         return createWrapper<XRReferenceSpaceEvent>(globalObject, std::move(impl));
    // #endif
    // #if ENABLE(WEBXR)
    //     case XRSessionEventInterfaceType:
    //         return createWrapper<XRSessionEvent>(globalObject, std::move(impl));
    // #endif
    //     }
    default: {
        break;
    }
    }

    return createWrapper<Event>(globalObject, std::move(impl));
}

} // namespace WebCore
