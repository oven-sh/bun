import type { JSC } from "../protocol";

export function remoteObjectToString(remoteObject: JSC.Runtime.RemoteObject, topLevel?: boolean): string {
  const { type, subtype, value, description, className, preview } = remoteObject;
  switch (type) {
    case "undefined":
      return "undefined";
    case "boolean":
    case "number":
      return description ?? JSON.stringify(value);
    case "string":
      if (topLevel) {
        return String(value ?? description);
      }
      return JSON.stringify(value ?? description);
    case "symbol":
    case "bigint":
      return description!;
    case "function":
      return description!.replace("function", "ƒ") || "ƒ";
  }
  switch (subtype) {
    case "null":
      return "null";
    case "regexp":
    case "date":
    case "error":
      return description!;
  }
  if (preview) {
    return objectPreviewToString(preview);
  }
  if (className) {
    return className;
  }
  return description || "Object";
}

export function objectPreviewToString(objectPreview: JSC.Runtime.ObjectPreview): string {
  const { type, subtype, entries, properties, overflow, description, size } = objectPreview;
  if (type !== "object") {
    return remoteObjectToString(objectPreview);
  }
  let items: string[];
  if (entries) {
    items = entries.map(entryPreviewToString).sort();
  } else if (properties) {
    if (isIndexed(subtype)) {
      items = properties.map(indexedPropertyPreviewToString);
      if (subtype !== "array") {
        items.sort();
      }
    } else {
      items = properties.map(namedPropertyPreviewToString).sort();
    }
  } else {
    items = ["…"];
  }
  if (overflow) {
    items.push("…");
  }
  let label: string;
  if (description === "Object") {
    label = "";
  } else if (size === undefined) {
    label = description!;
  } else {
    label = `${description}(${size})`;
  }
  if (!items.length) {
    return label || "{}";
  }
  if (label) {
    label += " ";
  }
  if (isIndexed(subtype)) {
    return `${label}[${items.join(", ")}]`;
  }
  return `${label}{${items.join(", ")}}`;
}

function propertyPreviewToString(propertyPreview: JSC.Runtime.PropertyPreview): string {
  const { type, value, ...preview } = propertyPreview;
  if (type === "accessor") {
    return "ƒ";
  }
  return remoteObjectToString({ ...preview, type, description: value });
}

function entryPreviewToString(entryPreview: JSC.Runtime.EntryPreview): string {
  const { key, value } = entryPreview;
  if (key) {
    return `${objectPreviewToString(key)} => ${objectPreviewToString(value)}`;
  }
  return objectPreviewToString(value);
}

function namedPropertyPreviewToString(propertyPreview: JSC.Runtime.PropertyPreview): string {
  const { name, valuePreview } = propertyPreview;
  if (valuePreview) {
    return `${name}: ${objectPreviewToString(valuePreview)}`;
  }
  return `${name}: ${propertyPreviewToString(propertyPreview)}`;
}

function indexedPropertyPreviewToString(propertyPreview: JSC.Runtime.PropertyPreview): string {
  const { valuePreview } = propertyPreview;
  if (valuePreview) {
    return objectPreviewToString(valuePreview);
  }
  return propertyPreviewToString(propertyPreview);
}

function isIndexed(type?: JSC.Runtime.RemoteObject["subtype"]): boolean {
  return type === "array" || type === "set" || type === "weakset";
}
