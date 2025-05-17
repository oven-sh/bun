/*
 * Copyright (C) 2020 Sony Interactive Entertainment Inc.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "CryptoAlgorithmRegistry.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmAES_CBC.h"
#include "CryptoAlgorithmAES_CFB.h"
#include "CryptoAlgorithmAES_CTR.h"
#include "CryptoAlgorithmAES_GCM.h"
#include "CryptoAlgorithmAES_KW.h"
#include "CryptoAlgorithmECDH.h"
#include "CryptoAlgorithmECDSA.h"
#include "CryptoAlgorithmEd25519.h"
#include "CryptoAlgorithmHKDF.h"
#include "CryptoAlgorithmHMAC.h"
#include "CryptoAlgorithmPBKDF2.h"
#include "CryptoAlgorithmRSAES_PKCS1_v1_5.h"
#include "CryptoAlgorithmRSASSA_PKCS1_v1_5.h"
#include "CryptoAlgorithmRSA_OAEP.h"
#include "CryptoAlgorithmRSA_PSS.h"
#include "CryptoAlgorithmSHA1.h"
#include "CryptoAlgorithmSHA224.h"
#include "CryptoAlgorithmSHA256.h"
#include "CryptoAlgorithmSHA384.h"
#include "CryptoAlgorithmSHA512.h"
#include "CryptoAlgorithmX25519.h"

namespace WebCore {

void CryptoAlgorithmRegistry::platformRegisterAlgorithms()
{
    registerAlgorithm<CryptoAlgorithmAES_CBC>();
    registerAlgorithm<CryptoAlgorithmAES_CFB>();
    registerAlgorithm<CryptoAlgorithmAES_CTR>();
    registerAlgorithm<CryptoAlgorithmAES_GCM>();
    registerAlgorithm<CryptoAlgorithmAES_KW>();
    registerAlgorithm<CryptoAlgorithmECDH>();
    registerAlgorithm<CryptoAlgorithmECDSA>();
    registerAlgorithm<CryptoAlgorithmHKDF>();
    registerAlgorithm<CryptoAlgorithmHMAC>();
    registerAlgorithm<CryptoAlgorithmPBKDF2>();
    registerAlgorithm<CryptoAlgorithmRSAES_PKCS1_v1_5>();
    registerAlgorithm<CryptoAlgorithmRSASSA_PKCS1_v1_5>();
    registerAlgorithm<CryptoAlgorithmRSA_OAEP>();
    registerAlgorithm<CryptoAlgorithmRSA_PSS>();
    registerAlgorithmWithAlternativeName<CryptoAlgorithmSHA1>();
    registerAlgorithmWithAlternativeName<CryptoAlgorithmSHA224>();
    registerAlgorithmWithAlternativeName<CryptoAlgorithmSHA256>();
    registerAlgorithmWithAlternativeName<CryptoAlgorithmSHA384>();
    registerAlgorithmWithAlternativeName<CryptoAlgorithmSHA512>();
    registerAlgorithm<CryptoAlgorithmEd25519>();
    registerAlgorithm<CryptoAlgorithmX25519>();
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
