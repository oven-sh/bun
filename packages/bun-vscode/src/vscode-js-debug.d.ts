/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

declare module '@vscode/js-debug' {
    import type * as vscode from 'vscode';

    /** @see {IExports.registerDebugTerminalOptionsProvider} */
    export interface IDebugTerminalOptionsProvider {
        /**
         * Called when the user creates a JavaScript Debug Terminal. It's called
         * with the options js-debug wants to use to create the terminal. It should
         * modify and return the options to use in the terminal.
         *
         * In order to avoid conflicting with existing logic, participants should
         * try to modify options in a additive way. For example prefer appending
         * to rather than reading and overwriting `options.env.PATH`.
         */
        provideTerminalOptions(options: vscode.TerminalOptions): vscode.ProviderResult<vscode.TerminalOptions>;
    }

    /**
     * Defines the exports of the `js-debug` extension. Once you have this typings
     * file, these can be acquired in your extension using the following code:
     *
     * ```
     * const jsDebugExt = vscode.extensions.getExtension('ms-vscode.js-debug-nightly')
     *   || vscode.extensions.getExtension('ms-vscode.js-debug');
     * await jsDebugExt.activate()
     * const jsDebug: import('@vscode/js-debug').IExports = jsDebug.exports;
     * ```
     */
    export interface IExports {
        /**
         * Registers a participant used when the user creates a JavaScript Debug Terminal.
         */
        registerDebugTerminalOptionsProvider(provider: IDebugTerminalOptionsProvider): vscode.Disposable;
    }
}