// tailwind.config.js
import { animate } from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["src/**/*.{ts,tsx}", "styles/**/*.{css,scss}"],
  theme: {
    extend: {
      colors: {
        border: "var(--text-border)",
        input: "var(--text-input)",
        ring: "var(--text-ring)",
        background: "var(--text-background)",
        foreground: "var(--text-foreground)",
        primary: {
          DEFAULT: "var(--text-primary)",
          foreground: "var(--text-primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--text-secondary)",
          foreground: "var(--text-secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--text-destructive)",
          foreground: "var(--text-destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--text-muted)",
          foreground: "var(--text-muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--text-accent)",
          foreground: "var(--text-accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--text-popover)",
          foreground: "var(--text-popover-foreground)",
        },
        card: {
          DEFAULT: "var(--text-card)",
          foreground: "var(--text-card-foreground)",
        },
      },
      borderRadius: {
        xs: `calc(var(--radius) - 4px)`,
        sm: `calc(var(--radius) - 2px)`,
        md: `var(--radius)`,
        lg: `calc(var(--radius) + 2px)`,
      },
    },
  },
  plugins: [animate],
};
