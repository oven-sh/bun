import * as vscode from "vscode";
import { CancellationToken, DebugConfiguration, ProviderResult, WorkspaceFolder } from "vscode";
import lockfile from "./lockfile";
import { VSCodeAdapter } from "./adapter";

const debugConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Debug Bun",
  program: "${file}",
};

const runConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "launch",
  name: "Run Bun",
  program: "${file}",
};

const attachConfiguration: vscode.DebugConfiguration = {
  type: "bun",
  request: "attach",
  name: "Attach to Bun",
  hostname: "localhost",
  port: 6499,
};

const debugConfigurations: vscode.DebugConfiguration[] = [debugConfiguration, attachConfiguration];

export function activateBunDebug(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {
  lockfile(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("extension.bun.runEditorContents", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(undefined, runConfiguration, {
          noDebug: true,
        });
      }
    }),
    vscode.commands.registerCommand("extension.bun.debugEditorContents", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(undefined, {
          ...debugConfiguration,
          program: targetResource.fsPath,
        });
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("extension.bun.getProgramName", config => {
      return vscode.window.showInputBox({
        placeHolder: "Please enter the name of a file in the workspace folder",
        value: "src/index.js",
      });
    }),
  );

  const provider = new BunConfigurationProvider();
  context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("bun", provider));

  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      "bun",
      {
        provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
          return debugConfigurations;
        },
      },
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
  );

  if (!factory) {
    factory = new InlineDebugAdapterFactory();
  }
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("bun", factory));
  if ("dispose" in factory && typeof factory.dispose === "function") {
    // @ts-ignore
    context.subscriptions.push(factory);
  }
}

class BunConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration,
    token?: CancellationToken,
  ): ProviderResult<DebugConfiguration> {
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && isJavaScript(editor.document.languageId)) {
        Object.assign(config, debugConfiguration);
      }
    }
    return config;
  }
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
    const adapter = new VSCodeAdapter(_session);
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}

function isJavaScript(languageId: string): boolean {
  return (
    languageId === "javascript" ||
    languageId === "javascriptreact" ||
    languageId === "typescript" ||
    languageId === "typescriptreact"
  );
}
