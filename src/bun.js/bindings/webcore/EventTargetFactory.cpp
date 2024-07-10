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
#include "EventTargetHeaders.h"
#include "JSDOMWrapperCache.h"

#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/StructureInlines.h>

namespace WebCore {

JSC::JSValue toJS(JSC::JSGlobalObject* state, JSDOMGlobalObject* globalObject, EventTarget& impl)
{
    switch (impl.eventTargetInterface()) {
    case EventTargetInterfaceType:
        break;
    case AbortSignalEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<AbortSignal&>(impl));
        // #if ENABLE(APPLE_PAY)
        //     case ApplePaySessionEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<ApplePaySession&>(impl));
        // #endif
        // #if ENABLE(WEB_AUDIO)
        //     case AudioNodeEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<AudioNode&>(impl));
        // #endif
        // #if ENABLE(VIDEO)
        //     case AudioTrackListEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<AudioTrackList&>(impl));
        // #endif
        // #if ENABLE(WEB_AUDIO)
        //     case BaseAudioContextEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<BaseAudioContext&>(impl));
        // #endif
    case BroadcastChannelEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<BroadcastChannel&>(impl));
        //     case ClipboardEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<Clipboard&>(impl));
        //     case DOMApplicationCacheEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<DOMApplicationCache&>(impl));
    case DOMWindowEventTargetInterfaceType:
        return globalObject;
        //     case DedicatedWorkerGlobalScopeEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<DedicatedWorkerGlobalScope&>(impl));
        //     case EventSourceEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<EventSource&>(impl));
        //     case FileReaderEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<FileReader&>(impl));
        //     case FontFaceSetEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<FontFaceSet&>(impl));
        //     case GPUDeviceEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<GPUDevice&>(impl));
        //     case IDBDatabaseEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<IDBDatabase&>(impl));
        //     case IDBOpenDBRequestEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<IDBOpenDBRequest&>(impl));
        //     case IDBRequestEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<IDBRequest&>(impl));
        //     case IDBTransactionEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<IDBTransaction&>(impl));
        // #if ENABLE(VIDEO)
        //     case MediaControllerEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaController&>(impl));
        // #endif
        // #if ENABLE(MEDIA_STREAM)
        //     case MediaDevicesEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaDevices&>(impl));
        // #endif
        // #if ENABLE(ENCRYPTED_MEDIA)
        //     case MediaKeySessionEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaKeySession&>(impl));
        // #endif
        //     case MediaQueryListEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaQueryList&>(impl));
        // #if ENABLE(MEDIA_RECORDER)
        //     case MediaRecorderEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaRecorder&>(impl));
        // #endif
        // #if ENABLE(MEDIA_SESSION_COORDINATOR)
        //     case MediaSessionCoordinatorEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaSessionCoordinator&>(impl));
        // #endif
        // #if ENABLE(MEDIA_SOURCE)
        //     case MediaSourceEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaSource&>(impl));
        // #endif
        // #if ENABLE(MEDIA_STREAM)
        //     case MediaStreamEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaStream&>(impl));
        // #endif
        // #if ENABLE(MEDIA_STREAM)
        //     case MediaStreamTrackEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<MediaStreamTrack&>(impl));
        // #endif
    case MessagePortEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<MessagePort&>(impl));
        //     case NodeEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<Node&>(impl));
        // #if ENABLE(NOTIFICATIONS)
        //     case NotificationEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<Notification&>(impl));
        // #endif
        // #if ENABLE(OFFSCREEN_CANVAS)
        //     case OffscreenCanvasEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<OffscreenCanvas&>(impl));
        // #endif
        // #if ENABLE(PAYMENT_REQUEST)
        //     case PaymentRequestEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<PaymentRequest&>(impl));
        // #endif
        // #if ENABLE(PAYMENT_REQUEST)
        //     case PaymentResponseEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<PaymentResponse&>(impl));
        // #endif
        //     case PerformanceEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<Performance&>(impl));
        //     case PermissionStatusEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<PermissionStatus&>(impl));
        // #if ENABLE(PICTURE_IN_PICTURE_API)
        //     case PictureInPictureWindowEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<PictureInPictureWindow&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCDTMFSenderEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCDTMFSender&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCDataChannelEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCDataChannel&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCDtlsTransportEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCDtlsTransport&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCIceTransportEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCIceTransport&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCPeerConnectionEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCPeerConnection&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCRtpSFrameTransformEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCRtpSFrameTransform&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCRtpScriptTransformEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCRtpScriptTransform&>(impl));
        // #endif
        // #if ENABLE(WEB_RTC)
        //     case RTCSctpTransportEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RTCSctpTransport&>(impl));
        // #endif
        // #if ENABLE(WIRELESS_PLAYBACK_TARGET)
        //     case RemotePlaybackEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<RemotePlayback&>(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case ServiceWorkerEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<ServiceWorker&>(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case ServiceWorkerContainerEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<ServiceWorkerContainer&>(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case ServiceWorkerGlobalScopeEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<ServiceWorkerGlobalScope&>(impl));
        // #endif
        // #if ENABLE(SERVICE_WORKER)
        //     case ServiceWorkerRegistrationEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<ServiceWorkerRegistration&>(impl));
        // #endif
        //     case SharedWorkerEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<SharedWorker&>(impl));
        //     case SharedWorkerGlobalScopeEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<SharedWorkerGlobalScope&>(impl));
        // #if ENABLE(MEDIA_SOURCE)
        //     case SourceBufferEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<SourceBuffer&>(impl));
        // #endif
        // #if ENABLE(MEDIA_SOURCE)
        //     case SourceBufferListEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<SourceBufferList&>(impl));
        // #endif
        //     case SpeechRecognitionEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<SpeechRecognition&>(impl));
        // #if ENABLE(SPEECH_SYNTHESIS)
        //     case SpeechSynthesisEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<SpeechSynthesis&>(impl));
        // #endif
        // #if ENABLE(SPEECH_SYNTHESIS)
        //     case SpeechSynthesisUtteranceEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<SpeechSynthesisUtterance&>(impl));
        // #endif
        // #if ENABLE(VIDEO)
        //     case TextTrackEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<TextTrack&>(impl));
        // #endif
        // #if ENABLE(VIDEO)
        //     case TextTrackCueEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<TextTrackCue&>(impl));
        // #endif
        // #if ENABLE(VIDEO)
        //     case TextTrackCueGenericEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<TextTrackCueGeneric&>(impl));
        // #endif
        // #if ENABLE(VIDEO)
        //     case TextTrackListEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<TextTrackList&>(impl));
        // #endif
        // #if ENABLE(VIDEO)
        //     case VideoTrackListEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<VideoTrackList&>(impl));
        // #endif
        //     case VisualViewportEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<VisualViewport&>(impl));
        //     case WebAnimationEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<WebAnimation&>(impl));
        // #if ENABLE(LEGACY_ENCRYPTED_MEDIA)
        //     case WebKitMediaKeySessionEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<WebKitMediaKeySession&>(impl));
        // #endif
    case WebSocketEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<WebSocket&>(impl));
        // #if ENABLE(WEBXR)
        //     case WebXRLayerEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<WebXRLayer&>(impl));
        // #endif
        // #if ENABLE(WEBXR)
        //     case WebXRSessionEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<WebXRSession&>(impl));
        // #endif
        // #if ENABLE(WEBXR)
        //     case WebXRSpaceEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<WebXRSpace&>(impl));
        // #endif
        // #if ENABLE(WEBXR)
        //     case WebXRSystemEventTargetInterfaceType:
        //         return toJS(state, globalObject, static_cast<WebXRSystem&>(impl));
        // #endif
    case WorkerEventTargetInterfaceType:
        return toJS(state, globalObject, static_cast<Worker&>(impl));
    //     case WorkletGlobalScopeEventTargetInterfaceType:
    //         return toJS(state, globalObject, static_cast<WorkletGlobalScope&>(impl));
    //     case XMLHttpRequestEventTargetInterfaceType:
    //         return toJS(state, globalObject, static_cast<XMLHttpRequest&>(impl));
    //     case XMLHttpRequestUploadEventTargetInterfaceType:
    //         return toJS(state, globalObject, static_cast<XMLHttpRequestUpload&>(impl));
    //     }
    default: {
        break;
    }
    }
    return wrap(state, globalObject, impl);
}

} // namespace WebCore
