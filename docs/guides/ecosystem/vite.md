---
name: Build a frontend using Vite and Bun
---

{% callout %}
While Vite currently works with Bun, it has not been heavily optimized, nor has Vite been adapted to use Bun's bundler, module resolver, or transpiler. This means that while you can use Bun to speed up your development process, some features might not work as efficiently as they do with Node.js.
{% /callout %}

---

**Getting Started with Vite and Bun**

Vite is designed to work seamlessly with Bun, allowing you to quickly set up a new project. Here's how you can get started:

1. **Create a New Vite Project with Bun**

   Use the following command to create a new Vite project. This command scaffolds a new project in your specified directory, allowing you to choose your preferred framework and variant.

   ```bash
   $ bun create vite my-app
   ✔ Select a framework: › React
   ✔ Select a variant: › TypeScript + SWC
   Scaffolding project in /path/to/my-app...
   ```

   *Explanation:* The `bun create vite my-app` command initializes a new project using Vite. You will be prompted to select a framework (e.g., React, Vue, Angular) and a variant (e.g., JavaScript, TypeScript).

2. **Navigate to Your Project Directory**

   Change into your project directory and install the necessary dependencies.

   ```bash
   cd my-app
   bun install
   ```

3. **Start the Development Server**

   You can start the development server using the `vite` CLI with the help of `bunx`.

   The `--bun` flag instructs Bun to execute Vite's CLI using `bun` instead of `node`. By default, Bun respects Vite's shebang line.

   ```bash
   bunx --bun vite
   ```

   *Note:* The shebang line is a directive that tells the system what interpreter to use to execute the script. More information can be found [here](<https://en.wikipedia.org/wiki/Shebang_(Unix)>).

4. **Simplify the Development Server Command**

   To make starting the development server easier, you can update the `"dev"` script in your `package.json` file as follows:

   ```json-diff#package.json
     "scripts": {
   -   "dev": "vite",
   +   "dev": "bunx --bun vite",
       "build": "vite build",
       "serve": "vite preview"
     },
     // ...
   ```

   Now, you can start the development server simply by running:

   ```bash
   bun run dev
   ```

5. **Build Your App for Production**

   When you're ready to build your app for production, use the following command:

   ```bash
   $ bunx --bun vite build
   ```

---
Below is an example of script configurations for an application using Vite:

```json
{
  "scripts": {
    "dev": "bunx --bun vite",
    "build": "bunx --bun vite build",
    "preview": "bunx --bun vite preview"
  }
}
```
---
This guide provides a concise overview of setting up a development environment with Vite and Bun. For a more comprehensive understanding, refer to the [Vite documentation](https://vitejs.dev/guide/).
