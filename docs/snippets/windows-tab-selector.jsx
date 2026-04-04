export function WindowsTabSelector() {
  return (
    <div className="windows-tab-selector">
      <p>
        <strong>On Windows?</strong> Use PowerShell to install Bun:
      </p>
      <pre>
        <code>powershell -c "irm bun.sh/install.ps1|iex"</code>
      </pre>
    </div>
  );
}

export default WindowsTabSelector;
