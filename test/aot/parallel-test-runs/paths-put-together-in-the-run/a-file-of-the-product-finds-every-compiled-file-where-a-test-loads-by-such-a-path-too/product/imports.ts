export async function byImport(parts: string[]) {
  const name = parts.join("/");
  try {
    const found = await import(name);
    return `import ${name}: ${Object.keys(found).sort()} ${(found.other ?? found.default ?? found.unread)?.("x")}`;
  } catch (error: any) {
    return `import ${name}: ${error.code}`;
  }
}
