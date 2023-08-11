import * as vscode from "vscode";
import { spawn } from "node:child_process";

export type BunLockfile = vscode.CustomDocument & {
  readonly preview: string;
};

export class BunLockfileEditorProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken,
  ): Promise<BunLockfile> {
    const preview = await previewLockfile(uri, token);
    return {
      uri,
      preview,
      dispose() {},
    };
  }

  async resolveCustomEditor(
    document: BunLockfile,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const { preview } = document;
    renderLockfile(webviewPanel, preview);
  }
}

function renderLockfile(webviewPanel: vscode.WebviewPanel, preview: string): void {
  // TODO: Improve syntax highlighting to match that of yarn.lock
  webviewPanel.webview.html = `<pre><code class="language-yaml">${preview}</code></pre>`;
}

function previewLockfile(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn("bun", [uri.fsPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    token.onCancellationRequested(() => {
      process.kill();
    });
    let stdout = "";
    process.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    let stderr = "";
    process.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    process.on("error", (error) => {
      reject(error);
    });
    process.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Bun exited with code: ${code}\n${stderr}`));
      }
    });
  });
}

export default function(context: vscode.ExtensionContext): void {
  const viewType = "bun.lockb";
  const provider = new BunLockfileEditorProvider(context);
  
  vscode.window.registerCustomEditorProvider(
    viewType,
    provider,
    {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: {
        enableFindWidget: true,
        retainContextWhenHidden: true,
      },
    },
  );
}
