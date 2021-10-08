import { CSSInJSStyles } from "src/css-in-js-styles";
import { Main } from "src/main";
export function CSSInJS() {
  return (
    <>
      <CSSInJSStyles />
      <Main
        productName={
          typeof location !== "undefined"
            ? decodeURIComponent(location.search.substring(1))
            : ""
        }
        cssInJS="Emotion"
      />
    </>
  );
}

export default CSSInJS;
