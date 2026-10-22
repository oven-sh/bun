// Two roads to one module: tls common. It prints what plain Bun prints.
import * as space from "node:_tls_common";
import whole from "node:_tls_common";
import { SecureContext as named_SecureContext, createSecureContext as named_createSecureContext, translatePeerCertificate as named_translatePeerCertificate } from "node:_tls_common";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_tls_common");
const asked = process.getBuiltinModule("node:_tls_common");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("SecureContext", named_SecureContext === space.SecureContext, named_SecureContext === whole.SecureContext, named_SecureContext === required.SecureContext, named_SecureContext === asked.SecureContext, space.SecureContext === required.SecureContext, whole.SecureContext === required.SecureContext, asked.SecureContext === required.SecureContext, whole.SecureContext === space.SecureContext);
same("createSecureContext", named_createSecureContext === space.createSecureContext, named_createSecureContext === whole.createSecureContext, named_createSecureContext === required.createSecureContext, named_createSecureContext === asked.createSecureContext, space.createSecureContext === required.createSecureContext, whole.createSecureContext === required.createSecureContext, asked.createSecureContext === required.createSecureContext, whole.createSecureContext === space.createSecureContext);
same("translatePeerCertificate", named_translatePeerCertificate === space.translatePeerCertificate, named_translatePeerCertificate === whole.translatePeerCertificate, named_translatePeerCertificate === required.translatePeerCertificate, named_translatePeerCertificate === asked.translatePeerCertificate, space.translatePeerCertificate === required.translatePeerCertificate, whole.translatePeerCertificate === required.translatePeerCertificate, asked.translatePeerCertificate === required.translatePeerCertificate, whole.translatePeerCertificate === space.translatePeerCertificate);
