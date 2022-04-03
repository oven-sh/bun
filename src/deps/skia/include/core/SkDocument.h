/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkDocument_DEFINED
#define SkDocument_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/core/SkScalar.h"

class SkCanvas;
class SkWStream;
struct SkRect;

/** SK_ScalarDefaultDPI is 72 dots per inch. */
static constexpr SkScalar SK_ScalarDefaultRasterDPI = 72.0f;

/**
 *  High-level API for creating a document-based canvas. To use..
 *
 *  1. Create a document, specifying a stream to store the output.
 *  2. For each "page" of content:
 *      a. canvas = doc->beginPage(...)
 *      b. draw_my_content(canvas);
 *      c. doc->endPage();
 *  3. Close the document with doc->close().
 */
class SK_API SkDocument : public SkRefCnt {
public:

    /**
     *  Begin a new page for the document, returning the canvas that will draw
     *  into the page. The document owns this canvas, and it will go out of
     *  scope when endPage() or close() is called, or the document is deleted.
     */
    SkCanvas* beginPage(SkScalar width, SkScalar height, const SkRect* content = nullptr);

    /**
     *  Call endPage() when the content for the current page has been drawn
     *  (into the canvas returned by beginPage()). After this call the canvas
     *  returned by beginPage() will be out-of-scope.
     */
    void endPage();

    /**
     *  Call close() when all pages have been drawn. This will close the file
     *  or stream holding the document's contents. After close() the document
     *  can no longer add new pages. Deleting the document will automatically
     *  call close() if need be.
     */
    void close();

    /**
     *  Call abort() to stop producing the document immediately.
     *  The stream output must be ignored, and should not be trusted.
     */
    void abort();

protected:
    SkDocument(SkWStream*);

    // note: subclasses must call close() in their destructor, as the base class
    // cannot do this for them.
    ~SkDocument() override;

    virtual SkCanvas* onBeginPage(SkScalar width, SkScalar height) = 0;
    virtual void onEndPage() = 0;
    virtual void onClose(SkWStream*) = 0;
    virtual void onAbort() = 0;

    // Allows subclasses to write to the stream as pages are written.
    SkWStream* getStream() { return fStream; }

    enum State {
        kBetweenPages_State,
        kInPage_State,
        kClosed_State
    };
    State getState() const { return fState; }

private:
    SkWStream* fStream;
    State      fState;

    using INHERITED = SkRefCnt;
};

#endif
