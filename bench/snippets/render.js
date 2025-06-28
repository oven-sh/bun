import ReactDOMServer from "react-dom/server.browser";
import decoding from "./jsx-entity-decoding";

console.log(ReactDOMServer.renderToString(decoding));
