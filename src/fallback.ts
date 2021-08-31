import { ByteBuffer } from "peechy";
import { FallbackStep } from "./api/schema";
import {
  decodeFallbackMessageContainer,
  FallbackMessageContainer,
} from "./api/schema";

function getFallbackInfo(): FallbackMessageContainer {
  var binary_string = window.atob(
    document.querySelector("#__bunfallback").textContent.trim()
  );
  document.querySelector("#__bunfallback").remove();

  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }

  return decodeFallbackMessageContainer(new ByteBuffer(bytes));
}

globalThis.__BUN_DATA__ = getFallbackInfo();
document.getElementById("__bun_fallback_script")?.remove();
