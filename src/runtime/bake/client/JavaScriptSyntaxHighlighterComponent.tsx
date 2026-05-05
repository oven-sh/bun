// This code isn't actually used by the client
// It exists so we can visually see the syntax highlighter in action
import { DraculaSyntaxHighlighter } from "./JavaScriptSyntaxHighlighter";
import "./JavaScriptSyntaxHighlighter.css";

interface SyntaxHighlighterProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  redactSensitiveInformation?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const SyntaxHighlighter: React.FC<SyntaxHighlighterProps> = ({
  code,
  language = "javascript",
  showLineNumbers = true,
  redactSensitiveInformation = false,
  className = "",
  style = {},
}) => {
  // Create a new instance of the highlighter
  const highlighter = new DraculaSyntaxHighlighter(code, {
    enableColors: true,
    redactSensitiveInformation,
    languageName: language,
    showLineNumbers,
  });

  // Get the highlighted HTML
  const highlightedCode = highlighter.highlight();

  return (
    <div
      className={`dracula-syntax-highlighter ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: highlightedCode }}
    />
  );
};
