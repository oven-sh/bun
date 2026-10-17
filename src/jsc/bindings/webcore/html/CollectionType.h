/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003, 2004, 2005, 2006, 2007, 2008 Apple Inc. All rights reserved.
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

#pragma once

namespace WebCore {

enum class CollectionType : uint8_t {
    // Unnamed HTMLCollection types cached in the document.
    DocImages,    // all <img> elements in the document
    DocEmbeds,    // all <embed> elements
    DocEmpty,     // always empty (for document.applets)
    DocForms,     // all <form> elements
    DocLinks,     // all <a> _and_ <area> elements with a value for href
    DocAnchors,   // all <a> elements with a value for name
    DocScripts,   // all <script> elements
    DocAll,       // "all" elements (IE)

    // Named collection types cached in the document.
    WindowNamedItems,
    DocumentNamedItems,

    DocumentAllNamedItems, // Sub-collection returned by the "all" collection when there are multiple items with the same name

    // Unnamed HTMLCollection types cached in elements.
    NodeChildren, // first-level children (IE)
    TableTBodies, // all <tbody> elements in this table
    TSectionRows, // all row elements in this table section
    TableRows,
    TRCells,      // all cells in this row
    SelectOptions,
    SelectedOptions,
    DataListOptions,
    MapAreas,
    FormControls,
    FieldSetElements,
    ByClass,
    ByTag,
    ByHTMLTag,
    AllDescendants
};

enum class CollectionTraversalType : uint8_t { Descendants, WeakPtrDescendants, ChildrenOnly, CustomForwardOnly };
template<CollectionType collectionType>
struct CollectionTypeTraits {
    static const CollectionTraversalType traversalType = CollectionTraversalType::Descendants;
};

template<>
struct CollectionTypeTraits<CollectionType::NodeChildren> {
    static const CollectionTraversalType traversalType = CollectionTraversalType::ChildrenOnly;
};

template<>
struct CollectionTypeTraits<CollectionType::TRCells> {
    static const CollectionTraversalType traversalType = CollectionTraversalType::ChildrenOnly;
};

template<>
struct CollectionTypeTraits<CollectionType::TSectionRows> {
    static const CollectionTraversalType traversalType = CollectionTraversalType::ChildrenOnly;
};

template<>
struct CollectionTypeTraits<CollectionType::TableTBodies> {
    static const CollectionTraversalType traversalType = CollectionTraversalType::ChildrenOnly;
};

template<>
struct CollectionTypeTraits<CollectionType::TableRows> {
    static const CollectionTraversalType traversalType = CollectionTraversalType::CustomForwardOnly;
};

template<>
struct CollectionTypeTraits<CollectionType::FormControls> {
    static const CollectionTraversalType traversalType = CollectionTraversalType::CustomForwardOnly;
};

template<typename CollectionClass>
struct CollectionClassTraits;

} // namespace WebCore
