#pragma once

namespace WebCore {

struct FetchOptions {
    enum class Destination : uint8_t { EmptyString,
        Audio,
        Audioworklet,
        Document,
        Embed,
        Font,
        Image,
        Iframe,
        Manifest,
        Model,
        Object,
        Paintworklet,
        Report,
        Script,
        Serviceworker,
        Sharedworker,
        Style,
        Track,
        Video,
        Worker,
        Xslt };
    enum class Mode : uint8_t { Navigate,
        SameOrigin,
        NoCors,
        Cors };
    enum class Credentials : uint8_t { Omit,
        SameOrigin,
        Include };
    enum class Cache : uint8_t { Default,
        NoStore,
        Reload,
        NoCache,
        ForceCache,
        OnlyIfCached };
    enum class Redirect : uint8_t { Follow,
        Error,
        Manual };
};
}