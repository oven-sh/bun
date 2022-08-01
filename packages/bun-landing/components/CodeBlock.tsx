import * as shiki from "shiki";

// because we don't want to wait for it to reload everytime this page reloads
globalThis._highlighter ||= await shiki.getHighlighter({
  theme: "dracula",
});

const highlighter = globalThis._highlighter as shiki.Highlighter;

export default function CodeBlock({ children, lang = "js" }) {
  const html = highlighter.codeToHtml(children.trim(), { lang });
  return (
    <div className="CodeBlock" dangerouslySetInnerHTML={{ __html: html }} />
  );
};