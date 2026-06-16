:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
}
body {
  margin: 0;
  display: grid;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
  position: relative;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  opacity: 0.05;
  background: url("./logo.svg");
  background-size: 256px;
  transform: rotate(-12deg) scale(1.35);
  animation: slide 30s linear infinite;
  pointer-events: none;
}
@keyframes slide {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 256px 224px;
  }
}
.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
  position: relative;
  z-index: 1;
}
.logo-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 2rem;
  margin-bottom: 2rem;
}
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 0.3s;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.bun-logo {
  transform: scale(1.2);
}
.bun-logo:hover {
  filter: drop-shadow(0 0 2em #fbf0dfaa);
}
.react-logo {
  animation: spin 20s linear infinite;
}
.react-logo:hover {
  filter: drop-shadow(0 0 2em #61dafbaa);
}
@keyframes spin {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(360deg);
  }
}
h1 {
  font-size: 3.2em;
  line-height: 1.1;
}
code {
  background-color: #1a1a1a;
  padding: 0.2em 0.4em;
  border-radius: 0.3em;
  font-family: monospace;
}
.api-tester {
  margin: 2rem auto 0;
  width: 100%;
  max-width: 600px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.endpoint-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #1a1a1a;
  padding: 0.75rem;
  border-radius: 12px;
  font: monospace;
  border: 2px solid #fbf0df;
  transition: 0.3s;
  width: 100%;
  box-sizing: border-box;
}
.endpoint-row:focus-within {
  border-color: #f3d5a3;
}
.method {
  background: #fbf0df;
  color: #1a1a1a;
  padding: 0.3rem 0.7rem;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.9em;
  appearance: none;
  margin: 0;
  width: min-content;
  display: block;
  flex-shrink: 0;
  border: none;
}
.method option {
  text-align: left;
}
.url-input {
  width: 100%;
  flex: 1;
  background: 0;
  border: 0;
  color: #fbf0df;
  font: 1em monospace;
  padding: 0.2rem;
  outline: 0;
}
.url-input:focus {
  color: #fff;
}
.url-input::placeholder {
  color: rgba(251, 240, 223, 0.4);
}
.send-button {
  background: #fbf0df;
  color: #1a1a1a;
  border: 0;
  padding: 0.4rem 1.2rem;
  border-radius: 8px;
  font-weight: 700;
  transition: 0.1s;
  cursor: var(--bun-cursor);
}
.send-button:hover {
  background: #f3d5a3;
  transform: translateY(-1px);
  cursor: pointer;
}
.response-area {
  width: 100%;
  min-height: 120px;
  background: #1a1a1a;
  border: 2px solid #fbf0df;
  border-radius: 12px;
  padding: 0.75rem;
  color: #fbf0df;
  font: monospace;
  resize: vertical;
  box-sizing: border-box;
}
.response-area:focus {
  border-color: #f3d5a3;
}
.response-area::placeholder {
  color: rgba(251, 240, 223, 0.4);
}
@media (prefers-reduced-motion) {
  *,
  ::before,
  ::after {
    animation: none !important;
  }
}
