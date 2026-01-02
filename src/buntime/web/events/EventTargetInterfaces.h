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

enum EventTargetInterface {
#if ENABLE(APPLE_PAY)
    ApplePaySessionEventTargetInterfaceType = 1,
#endif
#if ENABLE(ENCRYPTED_MEDIA)
    MediaKeySessionEventTargetInterfaceType = 2,
#endif
#if ENABLE(LEGACY_ENCRYPTED_MEDIA)
    WebKitMediaKeySessionEventTargetInterfaceType = 3,
#endif
#if ENABLE(MEDIA_RECORDER)
    MediaRecorderEventTargetInterfaceType = 4,
#endif
#if ENABLE(MEDIA_SESSION_COORDINATOR)
    MediaSessionCoordinatorEventTargetInterfaceType = 5,
#endif
#if ENABLE(MEDIA_SOURCE)
    MediaSourceEventTargetInterfaceType = 6,
    SourceBufferEventTargetInterfaceType = 7,
    SourceBufferListEventTargetInterfaceType = 8,
#endif
#if ENABLE(MEDIA_STREAM)
    MediaDevicesEventTargetInterfaceType = 9,
    MediaStreamEventTargetInterfaceType = 10,
    MediaStreamTrackEventTargetInterfaceType = 11,
#endif
#if ENABLE(NOTIFICATIONS)
    NotificationEventTargetInterfaceType = 12,
#endif
#if ENABLE(OFFSCREEN_CANVAS)
    OffscreenCanvasEventTargetInterfaceType = 13,
#endif
#if ENABLE(PAYMENT_REQUEST)
    PaymentRequestEventTargetInterfaceType = 14,
    PaymentResponseEventTargetInterfaceType = 15,
#endif
#if ENABLE(PICTURE_IN_PICTURE_API)
    PictureInPictureWindowEventTargetInterfaceType = 16,
#endif
#if ENABLE(SERVICE_WORKER)
    ServiceWorkerEventTargetInterfaceType = 17,
    ServiceWorkerContainerEventTargetInterfaceType = 18,
    ServiceWorkerGlobalScopeEventTargetInterfaceType = 19,
    ServiceWorkerRegistrationEventTargetInterfaceType = 20,
#endif
#if ENABLE(SPEECH_SYNTHESIS)
    SpeechSynthesisEventTargetInterfaceType = 21,
    SpeechSynthesisUtteranceEventTargetInterfaceType = 22,
#endif
#if ENABLE(VIDEO)
    AudioTrackListEventTargetInterfaceType = 23,
    MediaControllerEventTargetInterfaceType = 24,
    TextTrackEventTargetInterfaceType = 25,
    TextTrackCueEventTargetInterfaceType = 26,
    TextTrackCueGenericEventTargetInterfaceType = 27,
    TextTrackListEventTargetInterfaceType = 28,
    VideoTrackListEventTargetInterfaceType = 29,
#endif
#if ENABLE(WEBXR)
    WebXRLayerEventTargetInterfaceType = 30,
    WebXRSessionEventTargetInterfaceType = 31,
    WebXRSpaceEventTargetInterfaceType = 32,
    WebXRSystemEventTargetInterfaceType = 33,
#endif
#if ENABLE(WEB_AUDIO)
    AudioNodeEventTargetInterfaceType = 34,
    BaseAudioContextEventTargetInterfaceType = 35,
#endif
#if ENABLE(WEB_RTC)
    RTCDTMFSenderEventTargetInterfaceType = 36,
    RTCDataChannelEventTargetInterfaceType = 37,
    RTCDtlsTransportEventTargetInterfaceType = 38,
    RTCIceTransportEventTargetInterfaceType = 39,
    RTCPeerConnectionEventTargetInterfaceType = 40,
    RTCRtpSFrameTransformEventTargetInterfaceType = 41,
    RTCRtpScriptTransformEventTargetInterfaceType = 42,
    RTCSctpTransportEventTargetInterfaceType = 43,
#endif
#if ENABLE(WIRELESS_PLAYBACK_TARGET)
    RemotePlaybackEventTargetInterfaceType = 44,
#endif
    EventTargetInterfaceType = 45,
    AbortSignalEventTargetInterfaceType = 46,
    BroadcastChannelEventTargetInterfaceType = 47,
    ClipboardEventTargetInterfaceType = 48,
    DOMApplicationCacheEventTargetInterfaceType = 49,
    DOMWindowEventTargetInterfaceType = 50,
    DedicatedWorkerGlobalScopeEventTargetInterfaceType = 51,
    EventSourceEventTargetInterfaceType = 52,
    FileReaderEventTargetInterfaceType = 53,
    FontFaceSetEventTargetInterfaceType = 54,
    GPUDeviceEventTargetInterfaceType = 55,
    IDBDatabaseEventTargetInterfaceType = 56,
    IDBOpenDBRequestEventTargetInterfaceType = 57,
    IDBRequestEventTargetInterfaceType = 58,
    IDBTransactionEventTargetInterfaceType = 59,
    MediaQueryListEventTargetInterfaceType = 60,
    MessagePortEventTargetInterfaceType = 61,
    NodeEventTargetInterfaceType = 62,
    PerformanceEventTargetInterfaceType = 63,
    PermissionStatusEventTargetInterfaceType = 64,
    SharedWorkerEventTargetInterfaceType = 65,
    SharedWorkerGlobalScopeEventTargetInterfaceType = 66,
    SpeechRecognitionEventTargetInterfaceType = 67,
    VisualViewportEventTargetInterfaceType = 68,
    WebAnimationEventTargetInterfaceType = 69,
    WebSocketEventTargetInterfaceType = 70,
    WorkerEventTargetInterfaceType = 71,
    WorkletGlobalScopeEventTargetInterfaceType = 72,
    XMLHttpRequestEventTargetInterfaceType = 73,
    XMLHttpRequestUploadEventTargetInterfaceType = 74,
};

} // namespace WebCore
