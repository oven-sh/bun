#pragma once

namespace WebCore {

enum class TaskSource : uint8_t {
    DOMManipulation,
    DatabaseAccess,
    FileReading,
    FontLoading,
    Geolocation,
    IdleTask,
    IndexedDB,
    MediaElement,
    Microtask,
    Networking,
    PerformanceTimeline,
    Permission,
    PostedMessageQueue,
    Speech,
    UserInteraction,
    WebGL,
    WebXR,
    WebSocket,

    // Internal to WebCore
    InternalAsyncTask, // Safe to re-order or delay.
};

} // namespace WebCore
