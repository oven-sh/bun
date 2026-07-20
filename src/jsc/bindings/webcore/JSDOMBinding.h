/*
 *  Copyright (C) 1999-2001 Harri Porten (porten@kde.org)
 *  Copyright (C) 2003-2006, 2008-2009, 2013, 2016 Apple Inc. All rights reserved.
 *  Copyright (C) 2007 Samuel Weinig <sam@webkit.org>
 *  Copyright (C) 2009 Google, Inc. All rights reserved.
 *  Copyright (C) 2012 Ericsson AB. All rights reserved.
 *  Copyright (C) 2013 Michael Pruett <michael@68k.org>
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#pragma once

// FIXME: Remove this header.

#include "ExceptionOr.h"
#include "JSDOMWrapperCache.h"
#include <JavaScriptCore/AuxiliaryBarrierInlines.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <cstddef>
#include <wtf/Forward.h>
#include <wtf/GetPtr.h>
#include <wtf/Vector.h>
