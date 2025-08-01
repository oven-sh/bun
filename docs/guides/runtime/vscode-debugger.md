---
name: Debugging Bun with the VS Code extension
---

{% note %}

VSCode extension support is currently buggy. We recommend the [Web Debugger](https://bun.com/guides/runtime/web-debugger) for now.

{% /note %}

Bun speaks the [WebKit Inspector Protocol](https://github.com/oven-sh/bun/blob/main/packages/bun-inspector-protocol/src/protocol/jsc/index.d.ts) so you can debug your code with an interactive debugger.

---

To install the extension, visit the [Bun for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) page on the VS Code marketplace website, then click Install.

{% image src="https://github.com/oven-sh/bun/assets/3084745/7c8c80e6-d49e-457a-a45e-45ebed946d56" /%}

---

Alternatively, search `bun-vscode` in the Extensions tab of VS Code.

{% image src="https://github.com/oven-sh/bun/assets/3084745/664b4c40-944c-4076-a4c2-f812aebd3dc9" /%}

---

Make sure you are installing the extension published by the verified Oven organization.

{% image src="https://github.com/oven-sh/bun/assets/3084745/73e6b09f-9ff1-4d85-b725-c5eb7215b6ae" /%}

---

Once installed, two new Bun-specific commands will appear in the Command Palette. To open the palette, click View > Command Palette, or type `Ctrl+Shift+P` (Windows, Linux) or `Cmd+Shift+P` on (Mac).

---

The `Bun: Run File` command will execute your code and print the output to the Debug Console in VS Code. Breakpoints will be ignored; this is similar to executing the file with `bun <file>` from the command line.

{% image src="https://github.com/oven-sh/bun/assets/3084745/1b2c7fd9-fbb9-486a-84d0-eb7ec135ded3" /%}

---

The `Bun: Debug File` command will execute your code and print the output to the Debug Console in VS Code. You can set breakpoints in your code by clicking to the left of a line number; a red dot should appear.

When you run the file with `Bun: Debug File`, execution will pause at the breakpoint. You can inspect the variables in scope and step through the code line-by-line using the VS Code controls.

{% image src="https://github.com/oven-sh/bun/assets/3084745/c579a36c-eb21-4a58-bc9c-74612aad82af" /%}
