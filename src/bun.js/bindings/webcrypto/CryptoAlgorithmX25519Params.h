/*
 * Copyright (C) 2023 Igalia S.L.
 * Copyright (C) 2024 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2,1 of the License, or (at your option) any later version.
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
 */

#pragma once

#include "CryptoAlgorithmParameters.h"
#include "CryptoKey.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/Strong.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

class CryptoAlgorithmX25519Params final : public CryptoAlgorithmParameters {
    WTF_MAKE_TZONE_ALLOCATED(CryptoAlgorithmX25519Params);

public:
    RefPtr<CryptoKey> publicKey;
    Class parametersClass() const final { return Class::X25519Params; }
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_CRYPTO_ALGORITHM_PARAMETERS(X25519Params)

#endif // ENABLE(WEB_CRYPTO)
