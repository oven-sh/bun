const options = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  noIndentedCodeBlocks: true,
  permissiveAutolinks: true,
};

// This subset needs no module evaluation or component overrides. Unsupported
// syntax returns null so the caller can use the full MDX pipeline.
export function tryRenderStaticMdx(source) {
  if (
    /[{}]/.test(source) ||
    /^[ \t]*(?:import|export)(?=[\s*"'])/m.test(source) ||
    /!\[|javascript|&#|&(?:Tab|NewLine|colon);/i.test(source)
  )
    return null;
  const text = source.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
  if (/^---\r?\n/.test(text)) return null;
  let start = text.indexOf("<");
  while (start !== -1) {
    if (!text.startsWith("<br", start)) return null;
    let end = start + 3;
    while (text[end] === " " || text[end] === "\t") end++;
    if (text[end] !== "/" || text[end + 1] !== ">") return null;
    start = text.indexOf("<", end + 2);
  }
  return Bun.markdown.html(text, options).replace(/<p>((?:[\t\n\v\f\r ]|<br[ \t]*\/>)+)<\/p>/g, "$1");
}
