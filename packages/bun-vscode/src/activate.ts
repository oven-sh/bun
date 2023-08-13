import * as vscode from "vscode";
import { CancellationToken, DebugConfiguration, ProviderResult, WorkspaceFolder } from "vscode";
import { DAPAdapter } from "./dap";
import lockfile from "./lockfile";

export function activateBunDebug(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {
  lockfile(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("extension.bun.runEditorContents", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(
          undefined,
          {
            type: "bun",
            name: "Run File",
            request: "launch",
            program: targetResource.fsPath,
          },
          { noDebug: true },
        );
      }
    }),
    vscode.commands.registerCommand("extension.bun.debugEditorContents", (resource: vscode.Uri) => {
      let targetResource = resource;
      if (!targetResource && vscode.window.activeTextEditor) {
        targetResource = vscode.window.activeTextEditor.document.uri;
      }
      if (targetResource) {
        vscode.debug.startDebugging(undefined, {
          type: "bun",
          name: "Debug File",
          request: "launch",
          program: targetResource.fsPath,
          stopOnEntry: true,
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
          return [
            {
              name: "Launch",
              request: "launch",
              type: "bun",
              program: "${file}",
            },
          ];
        },
      },
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
  );

  if (!factory) {
    factory = new InlineDebugAdapterFactory();
  }
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory("bun", factory));
  if ("dispose" in factory) {
    // @ts-expect-error ???
    context.subscriptions.push(factory);
  }
}

class BunConfigurationProvider implements vscode.DebugConfigurationProvider {
  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration,
    token?: CancellationToken,
  ): ProviderResult<DebugConfiguration> {
    // if launch.json is missing or empty
    if (!config.type && !config.request && !config.name) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "javascript") {
        config.type = "bun";
        config.name = "Launch";
        config.request = "launch";
        config.program = "${file}";
        config.stopOnEntry = true;
      }
    }

    if (!config.program) {
      return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
        return undefined; // abort launch
      });
    }

    return config;
  }
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new DAPAdapter(_session));
  }
}
