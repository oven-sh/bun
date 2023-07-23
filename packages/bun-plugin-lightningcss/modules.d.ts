import type { CSSModuleExports } from "lightningcss";

declare module "*.module.css" {
  const content: CSSModuleExports;
  export default content;
}

declare module "*.css" {
  const content: any;
  export default content;
}
