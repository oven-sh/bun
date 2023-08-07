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

#ifndef EventTargetHeaders_h
#define EventTargetHeaders_h

#include "AbortSignal.h"
#include "JSAbortSignal.h"
// #if ENABLE(APPLE_PAY)
// #include "ApplePaySession.h"
// #include "JSApplePaySession.h"
// #endif
// #if ENABLE(WEB_AUDIO)
// #include "AudioNode.h"
// #include "JSAudioNode.h"
// #endif
// #if ENABLE(VIDEO)
// #include "AudioTrackList.h"
// #include "JSAudioTrackList.h"
// #endif
// #if ENABLE(WEB_AUDIO)
// #include "BaseAudioContext.h"
// #include "JSBaseAudioContext.h"
// #endif
#include "BroadcastChannel.h"
// #include "Clipboard.h"
// #include "DOMApplicationCache.h"
// #include "DOMWindow.h"
// #include "DedicatedWorkerGlobalScope.h"
// #include "EventSource.h"
// #include "FileReader.h"
// #include "FontFaceSet.h"
// #include "GPUDevice.h"
// #include "IDBDatabase.h"
// #include "IDBOpenDBRequest.h"
// #include "IDBRequest.h"
// #include "IDBTransaction.h"
#include "JSBroadcastChannel.h"
// #include "JSClipboard.h"
// #include "JSDOMApplicationCache.h"
// #include "JSDOMWindow.h"
// #include "JSDedicatedWorkerGlobalScope.h"
// #include "JSEventSource.h"
// #include "JSFileReader.h"
// #include "JSFontFaceSet.h"
// #include "JSGPUDevice.h"
// #include "JSIDBDatabase.h"
// #include "JSIDBOpenDBRequest.h"
// #include "JSIDBRequest.h"
// #include "JSIDBTransaction.h"
// #if ENABLE(VIDEO)
// #include "JSMediaController.h"
// #include "MediaController.h"
// #endif
// #if ENABLE(MEDIA_STREAM)
// #include "JSMediaDevices.h"
// #include "MediaDevices.h"
// #endif
// #if ENABLE(ENCRYPTED_MEDIA)
// #include "JSMediaKeySession.h"
// #include "MediaKeySession.h"
// #endif
// #include "JSMediaQueryList.h"
// #include "MediaQueryList.h"
// #if ENABLE(MEDIA_RECORDER)
// #include "JSMediaRecorder.h"
// #include "MediaRecorder.h"
// #endif
// #if ENABLE(MEDIA_SESSION_COORDINATOR)
// #include "JSMediaSessionCoordinator.h"
// #include "MediaSessionCoordinator.h"
// #endif
// #if ENABLE(MEDIA_SOURCE)
// #include "JSMediaSource.h"
// #include "MediaSource.h"
// #endif
// #if ENABLE(MEDIA_STREAM)
// #include "JSMediaStream.h"
// #include "MediaStream.h"
// #endif
// #if ENABLE(MEDIA_STREAM)
// #include "JSMediaStreamTrack.h"
// #include "MediaStreamTrack.h"
// #endif
#include "MessagePort.h"
#include "JSMessagePort.h"
// #include "JSNode.h"
#include "Node.h"
// #if ENABLE(NOTIFICATIONS)
// #include "JSNotification.h"
// #include "Notification.h"
// #endif
// #if ENABLE(OFFSCREEN_CANVAS)
// #include "JSOffscreenCanvas.h"
// #include "OffscreenCanvas.h"
// #endif
// #if ENABLE(PAYMENT_REQUEST)
// #include "JSPaymentRequest.h"
// #include "PaymentRequest.h"
// #endif
// #if ENABLE(PAYMENT_REQUEST)
// #include "JSPaymentResponse.h"
// #include "PaymentResponse.h"
// #endif
// #include "JSPerformance.h"
// #include "JSPermissionStatus.h"
// #include "Performance.h"
// #include "PermissionStatus.h"
// #if ENABLE(PICTURE_IN_PICTURE_API)
// #include "JSPictureInPictureWindow.h"
// #include "PictureInPictureWindow.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCDTMFSender.h"
// #include "RTCDTMFSender.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCDataChannel.h"
// #include "RTCDataChannel.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCDtlsTransport.h"
// #include "RTCDtlsTransport.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCIceTransport.h"
// #include "RTCIceTransport.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCPeerConnection.h"
// #include "RTCPeerConnection.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCRtpSFrameTransform.h"
// #include "RTCRtpSFrameTransform.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCRtpScriptTransform.h"
// #include "RTCRtpScriptTransform.h"
// #endif
// #if ENABLE(WEB_RTC)
// #include "JSRTCSctpTransport.h"
// #include "RTCSctpTransport.h"
// #endif
// #if ENABLE(WIRELESS_PLAYBACK_TARGET)
// #include "JSRemotePlayback.h"
// #include "RemotePlayback.h"
// #endif
// #if ENABLE(SERVICE_WORKER)
// #include "JSServiceWorker.h"
// #include "ServiceWorker.h"
// #endif
// #if ENABLE(SERVICE_WORKER)
// #include "JSServiceWorkerContainer.h"
// #include "ServiceWorkerContainer.h"
// #endif
// #if ENABLE(SERVICE_WORKER)
// #include "JSServiceWorkerGlobalScope.h"
// #include "ServiceWorkerGlobalScope.h"
// #endif
// #if ENABLE(SERVICE_WORKER)
// #include "JSServiceWorkerRegistration.h"
// #include "ServiceWorkerRegistration.h"
// #endif
// #include "JSSharedWorker.h"
// #include "JSSharedWorkerGlobalScope.h"
// #include "SharedWorker.h"
// #include "SharedWorkerGlobalScope.h"
// #if ENABLE(MEDIA_SOURCE)
// #include "JSSourceBuffer.h"
// #include "SourceBuffer.h"
// #endif
// #if ENABLE(MEDIA_SOURCE)
// #include "JSSourceBufferList.h"
// #include "SourceBufferList.h"
// #endif
// #include "JSSpeechRecognition.h"
// #include "SpeechRecognition.h"
// #if ENABLE(SPEECH_SYNTHESIS)
// #include "JSSpeechSynthesis.h"
// #include "SpeechSynthesis.h"
// #endif
// #if ENABLE(SPEECH_SYNTHESIS)
// #include "JSSpeechSynthesisUtterance.h"
// #include "SpeechSynthesisUtterance.h"
// #endif
// #if ENABLE(VIDEO)
// #include "JSTextTrack.h"
// #include "TextTrack.h"
// #endif
// #if ENABLE(VIDEO)
// #include "JSTextTrackCue.h"
// #include "TextTrackCue.h"
// #endif
// #if ENABLE(VIDEO)
// #include "JSTextTrackCueGeneric.h"
// #include "TextTrackCueGeneric.h"
// #endif
// #if ENABLE(VIDEO)
// #include "JSTextTrackList.h"
// #include "TextTrackList.h"
// #endif
// #if ENABLE(VIDEO)
// #include "JSVideoTrackList.h"
// #include "VideoTrackList.h"
// #endif
// #include "VisualViewport.h"
// #include "JSVisualViewport.h"
// #include "WebAnimation.h"
// #include "JSWebAnimation.h"
// #if ENABLE(LEGACY_ENCRYPTED_MEDIA)
// #include "JSWebKitMediaKeySession.h"
// #include "WebKitMediaKeySession.h"
// #endif
#include "WebSocket.h"
#include "JSWebSocket.h"
// #if ENABLE(WEBXR)
// #include "JSWebXRLayer.h"
// #include "WebXRLayer.h"
// #endif
// #if ENABLE(WEBXR)
// #include "JSWebXRSession.h"
// #include "WebXRSession.h"
// #endif
// #if ENABLE(WEBXR)
// #include "JSWebXRSpace.h"
// #include "WebXRSpace.h"
// #endif
// #if ENABLE(WEBXR)
// #include "JSWebXRSystem.h"
// #include "WebXRSystem.h"
// #endif
#include "Worker.h"
#include "JSWorker.h"
// #include "WorkletGlobalScope.h"
// #include "JSWorkletGlobalScope.h"
// #include "XMLHttpRequest.h"
// #include "JSXMLHttpRequest.h"
// #include "XMLHttpRequestUpload.h"
// #include "JSXMLHttpRequestUpload.h"

#include "BunWorkerGlobalScope.h"

#endif // EventTargetHeaders_h
