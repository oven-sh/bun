#pragma once

#include "root.h"
#include "include/core/SkImage.h"

namespace WebCore {

class CanvasImageSource : public RefCounted<CanvasImageSource> {
    WTF_MAKE_ISO_ALLOCATED(CanvasImageSource);

public:
    m_blob* WebCore::Blob;
};

} // namespace WebCore