import * as vscode from 'vscode'

export function registerTestExplorer(context: vscode.ExtensionContext) {
    const controller = vscode.tests.createTestController('bun-tests', 'Bun Tests')
}