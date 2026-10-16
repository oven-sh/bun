/*
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2010-2014 Google Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 *
 */

#include "config.h"
#include "FileInputType.h"

#include "DOMFormData.h"
#include "Document.h"
#include "FileList.h"
#include "HTMLInputElement.h"
#include "InputTypeNames.h"
#include "LocalizedStrings.h"
#include "NodeDocument.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(FileInputType);

FileInputType::FileInputType(HTMLInputElement& element)
    : BaseClickableWithKeyInputType(Type::File, element)
    , m_fileList(FileList::create())
{
}

FileInputType::~FileInputType() = default;

const AtomString& FileInputType::formControlType() const
{
    return InputTypeNames::file();
}

bool FileInputType::appendFormData(DOMFormData& formData) const
{
    ASSERT(element());
    Ref element = *this->element();
    Ref fileList = m_fileList;

    auto name = element->name();

    // If no filename at all is entered, return successful but empty.
    // Null would be more logical, but Netscape posts an empty file. Argh.
    if (fileList->isEmpty()) {
        formData.append(name, Blob::create(std::span<const uint8_t> { }, element->document().globalObject()), emptyString());
        return true;
    }

    for (auto& file : fileList->files())
        formData.append(name, file.ptr(), file->fileName());
    return true;
}

bool FileInputType::valueMissing(StringView value) const
{
    ASSERT(element());
    return element()->isRequired() && value.isEmpty();
}

String FileInputType::valueMissingText() const
{
    ASSERT(element());
    return element()->multiple() ? validationMessageValueMissingForMultipleFileText() : validationMessageValueMissingForFileText();
}

String FileInputType::firstElementPathForInputValue() const
{
    if (m_fileList->isEmpty())
        return { };

    // HTML5 tells us that we're supposed to use this goofy value for
    // file input controls. Historically, browsers revealed the real
    // file path, but that's a privacy problem. Code on the web
    // decided to try to parse the value by looking for backslashes
    // (because that's what Windows file paths use). To be compatible
    // with that code, we make up a fake path for the file.
    return makeString("C:\\fakepath\\"_s, files().file(0).fileName());
}

void FileInputType::setValue(const String&, bool valueChanged, TextFieldEventBehavior, TextControlSetValueSelection)
{
    // FIXME: Should we clear the file list, or replace it with a new empty one here? This is observable from JavaScript through custom properties.
    if (!valueChanged)
        return;

    protect(files())->clear();
    ASSERT(element());
    protect(element())->updateValidity();
}

bool FileInputType::dirAutoUsesValue() const
{
    return false;
}

void FileInputType::setFiles(RefPtr<FileList>&& files)
{
    if (!files)
        return;

    m_fileList = files.releaseNonNull();

    ASSERT(element());
    protect(element())->updateValidity();
}

} // namespace WebCore
