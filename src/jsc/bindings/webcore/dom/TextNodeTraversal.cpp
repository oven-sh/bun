/*
 * Copyright (C) 2013 Apple Inc. All rights reserved.
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

#include "config.h"
#include "TextNodeTraversal.h"

#include "ContainerNode.h"
#include <wtf/text/StringBuilder.h>

namespace WebCore {
namespace TextNodeTraversal {

void appendContents(const ContainerNode& root, StringBuilder& result)
{
    for (RefPtr text = TextNodeTraversal::firstWithin(root); text; text = TextNodeTraversal::next(*text, &root))
        result.append(text->data());
}

String contentsAsString(const ContainerNode& root)
{
    StringBuilder result;
    appendContents(root, result);
    return result.toString();
}

String contentsAsString(const Node& root)
{
    if (auto text = dynamicDowncast<Text>(root))
        return text->data();
    if (auto containerNode = dynamicDowncast<ContainerNode>(root))
        return contentsAsString(*containerNode);
    return String();
}

String childTextContent(const ContainerNode& root)
{
    StringBuilder result;
    for (RefPtr text = TextNodeTraversal::firstChild(root); text; text = TextNodeTraversal::nextSibling(*text))
        result.append(text->data());
    return result.toString();
}

}
}
