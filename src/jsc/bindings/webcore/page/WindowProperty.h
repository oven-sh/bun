#pragma once

namespace WebCore {

class Document;
class Window;

// Base of the objects a window owns and hands to script: location, history, screen, the storage areas, the selection.
class WindowProperty {
public:
    Window* window() const { return m_window; }
    void detachFromWindow() { m_window = nullptr; }

    // The opaque root that the wrapper shares with the window's wrapper and its nodes'. The collector calls this.
    Document* document() const;

protected:
    explicit WindowProperty(Window& window)
        : m_window(&window)
    {
    }

private:
    Window* m_window;
};

} // namespace WebCore
