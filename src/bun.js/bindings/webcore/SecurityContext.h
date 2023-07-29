// /*
//  * Copyright (C) 2011 Google Inc. All Rights Reserved.
//  * Copyright (C) 2017 Apple Inc. All rights reserved.
//  *
//  * Redistribution and use in source and binary forms, with or without
//  * modification, are permitted provided that the following conditions
//  * are met:
//  * 1. Redistributions of source code must retain the above copyright
//  *    notice, this list of conditions and the following disclaimer.
//  * 2. Redistributions in binary form must reproduce the above copyright
//  *    notice, this list of conditions and the following disclaimer in the
//  *    documentation and/or other materials provided with the distribution.
//  *
//  * THIS SOFTWARE IS PROVIDED BY GOOGLE, INC. ``AS IS'' AND ANY
//  * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
//  * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
//  * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
//  * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
//  * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
//  * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
//  * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
//  * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//  * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
//  * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//  *
//  */

// #pragma once

// #include "CrossOriginEmbedderPolicy.h"
// #include "CrossOriginOpenerPolicy.h"
// #include <memory>
// #include <wtf/Forward.h>
// #include <wtf/OptionSet.h>
// #include <wtf/RefPtr.h>

// namespace WebCore {

// class SecurityOrigin;
// class SecurityOriginPolicy;
// class ContentSecurityPolicy;
// struct CrossOriginOpenerPolicy;
// struct PolicyContainer;
// enum class ReferrerPolicy : uint8_t;

// enum SandboxFlag {
//     // See http://www.whatwg.org/specs/web-apps/current-work/#attr-iframe-sandbox for a list of the sandbox flags.
//     SandboxNone = 0,
//     SandboxNavigation = 1,
//     SandboxPlugins = 1 << 1,
//     SandboxOrigin = 1 << 2,
//     SandboxForms = 1 << 3,
//     SandboxScripts = 1 << 4,
//     SandboxTopNavigation = 1 << 5,
//     SandboxPopups = 1 << 6, // See https://www.w3.org/Bugs/Public/show_bug.cgi?id=12393
//     SandboxAutomaticFeatures = 1 << 7,
//     SandboxPointerLock = 1 << 8,
//     SandboxPropagatesToAuxiliaryBrowsingContexts = 1 << 9,
//     SandboxTopNavigationByUserActivation = 1 << 10,
//     SandboxDocumentDomain = 1 << 11,
//     SandboxModals = 1 << 12,
//     SandboxStorageAccessByUserActivation = 1 << 13,
//     SandboxTopNavigationToCustomProtocols = 1 << 14,
//     SandboxAll = -1 // Mask with all bits set to 1.
// };

// typedef int SandboxFlags;

// class SecurityContext {
// public:
//     // https://html.spec.whatwg.org/multipage/origin.html#determining-the-creation-sandboxing-flags
//     SandboxFlags creationSandboxFlags() const { return m_creationSandboxFlags; }

//     SandboxFlags sandboxFlags() const { return m_sandboxFlags; }
//     ContentSecurityPolicy* contentSecurityPolicy() { return m_contentSecurityPolicy.get(); }

//     bool isSecureTransitionTo(const URL&) const;

//     enum class SandboxFlagsSource : bool { CSP,
//         Other };
//     void enforceSandboxFlags(SandboxFlags, SandboxFlagsSource = SandboxFlagsSource::Other);

//     bool isSandboxed(SandboxFlags mask) const { return m_sandboxFlags & mask; }

//     SecurityOriginPolicy* securityOriginPolicy() const { return m_securityOriginPolicy.get(); }

//     // Explicitly override the security origin for this security context.
//     // Note: It is dangerous to change the security origin of a script context
//     //       that already contains content.
//     void setSecurityOriginPolicy(RefPtr<SecurityOriginPolicy>&&);

//     // Explicitly override the content security policy for this security context.
//     // Note: It is dangerous to change the content security policy of a script
//     //       context that already contains content.
//     void setContentSecurityPolicy(std::unique_ptr<ContentSecurityPolicy>&&);

//     const CrossOriginEmbedderPolicy& crossOriginEmbedderPolicy() const { return m_crossOriginEmbedderPolicy; }
//     void setCrossOriginEmbedderPolicy(const CrossOriginEmbedderPolicy& crossOriginEmbedderPolicy) { m_crossOriginEmbedderPolicy = crossOriginEmbedderPolicy; }

//     virtual const CrossOriginOpenerPolicy& crossOriginOpenerPolicy() const { return m_crossOriginOpenerPolicy; }
//     void setCrossOriginOpenerPolicy(const CrossOriginOpenerPolicy& crossOriginOpenerPolicy) { m_crossOriginOpenerPolicy = crossOriginOpenerPolicy; }

//     virtual ReferrerPolicy referrerPolicy() const { return m_referrerPolicy; }
//     void setReferrerPolicy(ReferrerPolicy);

//     WEBCORE_EXPORT PolicyContainer policyContainer() const;
//     virtual void inheritPolicyContainerFrom(const PolicyContainer&);

//     WEBCORE_EXPORT SecurityOrigin* securityOrigin() const;

//     static SandboxFlags parseSandboxPolicy(StringView policy, String& invalidTokensErrorMessage);
//     static bool isSupportedSandboxPolicy(StringView);

//     enum MixedContentType : uint8_t {
//         Inactive = 1 << 0,
//         Active = 1 << 1,
//     };

//     bool usedLegacyTLS() const { return m_usedLegacyTLS; }
//     void setUsedLegacyTLS(bool used) { m_usedLegacyTLS = used; }
//     const OptionSet<MixedContentType>& foundMixedContent() const { return m_mixedContentTypes; }
//     bool wasPrivateRelayed() const { return m_wasPrivateRelayed; }
//     void setWasPrivateRelayed(bool privateRelayed) { m_wasPrivateRelayed = privateRelayed; }
//     void setFoundMixedContent(MixedContentType type) { m_mixedContentTypes.add(type); }
//     bool geolocationAccessed() const { return m_geolocationAccessed; }
//     void setGeolocationAccessed() { m_geolocationAccessed = true; }
//     bool secureCookiesAccessed() const { return m_secureCookiesAccessed; }
//     void setSecureCookiesAccessed() { m_secureCookiesAccessed = true; }

//     bool isStrictMixedContentMode() const { return m_isStrictMixedContentMode; }
//     void setStrictMixedContentMode(bool strictMixedContentMode) { m_isStrictMixedContentMode = strictMixedContentMode; }

//     // This method implements the "Is the environment settings object settings a secure context?" algorithm from
//     // the Secure Context spec: https://w3c.github.io/webappsec-secure-contexts/#settings-object (Editor's Draft, 17 November 2016)
//     virtual bool isSecureContext() const = 0;

//     bool haveInitializedSecurityOrigin() const { return m_haveInitializedSecurityOrigin; }

// protected:
//     SecurityContext();
//     virtual ~SecurityContext();

//     // It's only appropriate to call this during security context initialization; it's needed for
//     // flags that can't be disabled with allow-* attributes, such as SandboxNavigation.
//     void disableSandboxFlags(SandboxFlags mask) { m_sandboxFlags &= ~mask; }

//     void didFailToInitializeSecurityOrigin() { m_haveInitializedSecurityOrigin = false; }

// private:
//     void addSandboxFlags(SandboxFlags);

//     RefPtr<SecurityOriginPolicy> m_securityOriginPolicy;
//     std::unique_ptr<ContentSecurityPolicy> m_contentSecurityPolicy;
//     CrossOriginEmbedderPolicy m_crossOriginEmbedderPolicy;
//     CrossOriginOpenerPolicy m_crossOriginOpenerPolicy;
//     SandboxFlags m_creationSandboxFlags { SandboxNone };
//     SandboxFlags m_sandboxFlags { SandboxNone };
//     ReferrerPolicy m_referrerPolicy { ReferrerPolicy::Default };
//     OptionSet<MixedContentType> m_mixedContentTypes;
//     bool m_haveInitializedSecurityOrigin { false };
//     bool m_geolocationAccessed { false };
//     bool m_secureCookiesAccessed { false };
//     bool m_isStrictMixedContentMode { false };
//     bool m_usedLegacyTLS { false };
//     bool m_wasPrivateRelayed { false };
// };

// } // namespace WebCore
