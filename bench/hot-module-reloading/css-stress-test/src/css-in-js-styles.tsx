import { Global } from "@emotion/react";
export function CSSInJSStyles() {
  return (
    <Global
      styles={`
:root {
  --timestamp: "16336621338281";
  --interval: "16";
  --progress-bar: 56.889%;
  --spinner-1-muted: rgb(179, 6, 202);
  --spinner-1-primary: rgb(224, 8, 253);
  --spinner-2-muted: rgb(22, 188, 124);
  --spinner-2-primary: rgb(27, 235, 155);
  --spinner-3-muted: rgb(89, 72, 0);
  --spinner-3-primary: rgb(111, 90, 0);
  --spinner-4-muted: rgb(18, 84, 202);
  --spinner-4-primary: rgb(23, 105, 253);
  --spinner-rotate: 304deg;
}  `}
    />
  );
}
