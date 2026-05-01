declare var document: any;
import { ByteBuffer } from "peechy";
import { decodeFallbackMessageContainer, FallbackMessageContainer } from "./api/schema";

function getFallbackInfo(): FallbackMessageContainer {
  const binary_string = globalThis.atob(document.getElementById("__bunfallback").textContent.trim());

  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }

  return decodeFallbackMessageContainer(new ByteBuffer(bytes));
}

globalThis.__BUN_DATA__ = getFallbackInfo();
// It's probably better to remove potentially large content from the DOM when not in use
if ("requestIdleCallback" in globalThis) {
  globalThis.requestIdleCallback(() => {
    document.getElementById("__bunfallback")?.remove();
    document.getElementById("__bun_fallback_script")?.remove();
  });
}
