<script lang="ts">
  import FeatureCard from "./FeatureCard.svelte";

  const links = [
    { text: "Bun Documentation", url: "https://bun.com/docs" },
    { text: "Svelte Documentation", url: "https://svelte.dev/docs" },
    { text: "GitHub", url: "https://github.com/oven-sh/bun/tree/main/packages/bun-plugin-svelte" },
  ];
</script>

<main>
  <div class="hero">
    <div class="logo-container">
      <a href="https://bun.com" class="bun-logo">
        <img
          src="https://github.com/user-attachments/assets/50282090-adfd-4ddb-9e27-c30753c6b161"
          alt="Bun Logo"
          height="42"
        />
      </a>
    </div>
    <h1><span class="highlight">bun-plugin-svelte</span></h1>
    <p class="tagline">The official Svelte plugin for <a href="https://bun.com" target="_blank">Bun</a></p>

    <div class="cta-buttons">
      <a href="https://bun.com/docs/bundler/html" class="button primary">🚀 Get Started</a>
      <a href="https://github.com/oven-sh/bun/tree/main/packages/bun-plugin-svelte/example" class="button secondary"
        >👀 View Examples</a
      >
    </div>
  </div>

  <section class="usage">
    <h2>🏃‍➡️ Quick Start</h2>

    <div class="flex-grid">
      <div>
        <h3>1. Install from <a href="https://npmjs.com/package/bun-plugin-svelte" target="_blank">NPM</a></h3>
        <pre><code class="language-bash">bun add -D bun-plugin-svelte</code></pre>
      </div>
      <div>
        <h3>2. Add it to your <a href="https://bun.com/docs/runtime/bunfig" target="_blank">bunfig.toml</a></h3>
        <pre><code class="language-toml">
[serve.static]
plugins = ["bun-plugin-svelte"];
        </code></pre>
      </div>
    </div>
  </section>

  <section class="features">
    <h2>✨ Features</h2>
    <div class="feature-grid">
      <FeatureCard title="🔥 HMR Support" link="https://bun.com/docs/bundler/html">
        Integrates with Bun's Fullstack Dev Server for hot module replacement
      </FeatureCard>
      <FeatureCard title="📦 Bundling" link="https://bun.com/docs/bundler">
        Bundle Svelte components with <a href="https://bun.com/docs/bundler">Bun.build</a>
      </FeatureCard>
    </div>

    <section class="resources">
      <h2>📖 Resources</h2>
      <ul class="resource-links">
        {#each links as link}
          <li><a href={link.url} target="_blank" rel="noopener noreferrer">{link.text}</a></li>
        {/each}
      </ul>
    </section>

    <footer>
      <p>Made with ❤️ by the Bun team</p>
    </footer>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue",
      sans-serif;
    background-color: #f9f9f9;
    color: #333;
  }
  :global(a) {
    color: #ff3e00;
    text-decoration: none;
    position: relative;
  }

  :global(a::after) {
    content: "";
    position: absolute;
    width: 100%;
    height: 1px;
    bottom: 0;
    left: 0;
    background-color: #ff3e00;
    transform: scaleX(0);
    transform-origin: bottom right;
    transition: transform 0.3s ease-out;
  }

  :global(a:hover::after) {
    transform: scaleX(1);
    transform-origin: bottom left;
  }

  :global(a:visited) {
    color: #ff3e00;
  }

  :global(pre > code.hljs) {
    padding: 0;
  }

  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  .hero {
    text-align: center;
    padding: 3rem 1rem;
    margin-bottom: 2rem;
    display: flex;
    flex-direction: column;
  }

  .logo-container {
    margin-bottom: 1.5rem;
    margin: auto 25%;
  }

  .bun-logo {
    display: block;
    transition: transform 0.3s ease;
  }

  .bun-logo:hover {
    transform: scale(1.05);
  }

  .bun-logo img {
    max-width: 33vw;
    height: auto;
  }

  h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  .highlight {
    color: #ff3e00;
    font-weight: bold;
  }

  /* Don't apply the underline effect to buttons and resource links */
  .button::after,
  .resource-links li a::after,
  .bun-logo::after {
    display: none;
  }

  .tagline {
    font-size: 1.2rem;
    color: #666;
    margin-bottom: 2rem;
  }

  .cta-buttons {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .button {
    display: inline-block;
    padding: 0.8rem 1.5rem;
    border-radius: 4px;
    text-decoration: none;
    font-weight: 600;
    transition: all 0.2s ease;
  }

  .button.primary {
    background-color: #ff3e00;
    color: white;
    box-shadow: 0 2px 10px rgba(255, 62, 0, 0.2);
  }

  .button.primary:hover {
    background-color: #e63600;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(255, 62, 0, 0.3);
  }

  .button.secondary {
    background-color: #f0f0f0;
    color: #333;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .button.secondary:hover {
    background-color: #e6e6e6;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  section {
    margin-bottom: 3rem;
    padding: 2rem;
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 2px 15px rgba(0, 0, 0, 0.05);
  }

  h2 {
    font-size: 1.8rem;
    margin-bottom: 1.5rem;
    color: #333;
    border-bottom: 2px solid #f0f0f0;
    padding-bottom: 0.5rem;
  }

  .flex-grid {
    display: flex;
    gap: 1.5rem;
  }
  .flex-grid > div {
    flex: 1;
  }

  .feature-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2rem;
  }

  pre {
    background-color: #f5f5f5;
    padding: 1rem;
    border-radius: 4px;
    overflow-x: auto;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  code {
    color: #333;
  }

  .resource-links {
    list-style: none;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .resource-links li a {
    display: inline-block;
    padding: 0.5rem 1rem;
    background-color: #f5f5f5;
    color: #333;
    text-decoration: none;
    border-radius: 4px;
    transition: all 0.2s ease;
  }

  .resource-links li a:hover {
    background-color: #ff3e00;
    color: white;
    transform: translateY(-2px);
  }

  footer {
    text-align: center;
    padding: 2rem 0;
    color: #666;
    font-size: 0.9rem;
  }

  @media (max-width: 768px) {
    .feature-grid {
      grid-template-columns: 1fr;
    }

    .cta-buttons {
      flex-direction: column;
      align-items: center;
    }

    .button {
      width: 100%;
      max-width: 300px;
      margin-bottom: 0.5rem;
      text-align: center;
    }

    .resource-links {
      flex-direction: column;
    }
  }
</style>
