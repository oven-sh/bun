export function styleLockfile(preview: string) {
  // Match all lines that don't start with a whitespace character
  const lines = preview.split(/\n(?!\s)/);

  return lines.map(styleSection).join("\n");
}

function styleSection(section: string) {
  const lines = section.split(/\n/);

  return lines.map(styleLine).join("\n");
}

function styleLine(line: string) {
  if (line.startsWith("#")) {
    return `<span class="mtk5">${escapeHtml(line)}</span>`;
  }

  const parts = line.trim().split(" ");
  if (line.startsWith("    ")) {
    return `<span><span class="mtk1">&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(parts[0])}&nbsp;</span><span class="mtk16">${escapeHtml(parts[1])}</span></span>`;
  }
  if (line.startsWith("  ")) {
    const leftPart = `<span class="mtk6">&nbsp;&nbsp;${escapeHtml(parts[0])}&nbsp;</span>`;

    if (parts.length === 1) return `<span>${leftPart}</span>`;

    if (parts[1].startsWith('"http://') || parts[1].startsWith('"https://'))
      return `<span>${leftPart}<span class="mtk12 detected-link">${escapeHtml(parts[1])}</span></span>`;
    if (parts[1].startsWith('"')) return `<span>${leftPart}<span class="mtk16">${escapeHtml(parts[1])}</span></span>`;

    return `<span>${leftPart}<span class="mtk6">${escapeHtml(parts[1])}</span></span>`;
  }
  return `<span class="mtk1">${escapeHtml(line)}&nbsp;</span>`;
}

const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

function escapeHtml(text: string | undefined): string {
  return String(text).replace(/[&<>"']/g, character => htmlEscapes[character]);
}
