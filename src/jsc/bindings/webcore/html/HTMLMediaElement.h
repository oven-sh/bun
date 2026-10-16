/*
 * Copyright (C) 2007-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2015 Google Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
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

#include "HTMLElement.h"

namespace WebCore {

class TimeRanges;

class HTMLMediaElement : public HTMLElement {
    WTF_MAKE_TZONE_ALLOCATED(HTMLMediaElement);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(HTMLMediaElement);
public:
    virtual ~HTMLMediaElement();

    enum ReadyState : uint8_t { HAVE_NOTHING, HAVE_METADATA, HAVE_CURRENT_DATA, HAVE_FUTURE_DATA, HAVE_ENOUGH_DATA };
    enum NetworkState : uint8_t { NETWORK_EMPTY, NETWORK_IDLE, NETWORK_LOADING, NETWORK_NO_SOURCE };

    // network state
    String currentSrc() const { return emptyString(); }
    String crossOrigin() const;
    NetworkState networkState() const { return NETWORK_EMPTY; }
    Ref<TimeRanges> buffered() const;
    void load() { }
    String canPlayType(const String&) const { return emptyString(); }

    // ready state
    ReadyState readyState() const { return HAVE_NOTHING; }
    bool seeking() const { return false; }

    // playback state
    double currentTimeForBindings() const { return m_currentTime; }
    void setCurrentTimeForBindings(double time) { m_currentTime = time; }
    double duration() const { return std::numeric_limits<double>::quiet_NaN(); }
    bool paused() const { return true; }
    double defaultPlaybackRate() const { return m_defaultPlaybackRate; }
    void setDefaultPlaybackRate(double);
    double playbackRate() const { return m_playbackRate; }
    void setPlaybackRate(double);
    Ref<TimeRanges> played() const;
    Ref<TimeRanges> seekable() const;
    bool ended() const { return false; }
    void play() { }
    void pause() { }

    // controls
    double volume() const { return m_volume; }
    ExceptionOr<void> setVolume(double);
    bool muted() const { return m_muted; }
    void setMuted(bool);

    void addTextTrack(const AtomString&, const AtomString&, const AtomString&) { }

protected:
    HTMLMediaElement(const QualifiedName&, Document&);

    bool LEGACY_NODELETE isURLAttribute(const Attribute&) const override;

private:
    bool supportsFocus() const final;
    bool isInteractiveContent() const final;
    bool isReplaced() const final { return true; }

    double m_currentTime { 0 };
    double m_defaultPlaybackRate { 1 };
    double m_playbackRate { 1 };
    double m_volume { 1 };
    bool m_muted { false };
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::HTMLMediaElement)
    static bool isType(const WebCore::HTMLElement& element) { return element.hasTagName(WebCore::HTMLNames::audioTag) || element.hasTagName(WebCore::HTMLNames::videoTag); }
    static bool isType(const WebCore::Node& node)
    {
        auto* htmlElement = dynamicDowncast<WebCore::HTMLElement>(node);
        return htmlElement && isType(*htmlElement);
    }
SPECIALIZE_TYPE_TRAITS_END()
