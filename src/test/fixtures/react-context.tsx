import React from "react";
import type { DocumentProps } from "./internal/types";

export const DocumentContext = React.createContext<DocumentProps>(null as any);

if (process.env.NODE_ENV !== "production") {
  DocumentContext.displayName = "DocumentContext";
}
