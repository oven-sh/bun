# Bun-Elixir : Architecture et Standards

Ce document définit les mandates fondamentaux et les conventions architecturales pour le projet **Bun-Elixir**, une reconstruction haute performance de l'écosystème Node.js/Bun utilisant Elixir pour l'orchestration et Rust pour le moteur d'exécution.

## Architecture du Projet

Le projet est divisé en deux mondes interconnectés via **Rustler** :

### 1. Le Monde Elixir (`bun_next/lib`)
- **Responsabilité** : Orchestration de haut niveau, réseau (Req), gestion du cache, et assemblage final des bundles.
- **Composants Clés** :
  - `BunNext.Resolver` : Interroge le registre NPM et gère la résolution récursive des versions.
  - `BunNext.Downloader` : Téléchargement parallèle des archives `.tgz`.
  - `BunNext.Bundler` : Assemble les modules transformés par Rust dans un wrapper CommonJS pour l'exécution.
  - `BunNext.NodeUpdater` : Automatise la récupération des sources JS officielles de Node.js.

### 2. Le Monde Rust (`bun_next/native/native`)
- **Responsabilité** : Tâches intensives en CPU, parsing AST, transformation de code, et moteur d'exécution JavaScript.
- **Bibliothèques Critiques** :
  - `oxc` (Parser, Transformer, Codegen, Resolver) : Moteur de manipulation JS/TS ultra-rapide.
  - `boa_engine` : Runtime JavaScript 100% Rust pour l'exécution du code.
  - `flate2` / `tar` : Extraction haute performance des paquets.

## Standards d'Ingénierie

### Performance "YOLO" (Zéro Compromis)
- Les opérations sur les fichiers et l'AST doivent TOUJOURS se faire en Rust.
- Elixir ne doit jamais manipuler le contenu des fichiers JS, seulement coordonner leur flux.

### Compatibilité Node.js
- Le projet cible la version la plus récente de Node.js (actuellement v26.0.0).
- Le support des modules `node:*` est assuré par le téléchargement des sources JS officielles de Node, injectées dans un environnement émulé (`primordials`, `internalBinding`).

### Conventions de Code
- **Elixir** : Suivre les standards `mix format`. Utiliser `Task.async_stream` pour le parallélisme.
- **Rust** : Privilégier les types `oxc` pour toute manipulation de code. Éviter les Regex pour le parsing au profit de l'AST dès que possible.

## État de l'Implémentation

### Phases Complétées
- [x] **Phase 1-2** : Parsing `package.json`, téléchargement et extraction `.tgz`.
- [x] **Phase 3-4** : Résolution réelle via registre NPM (calcul Semver en Rust).
- [x] **Phase 5** : Transpilation TypeScript -> JavaScript via Oxc.
- [x] **Phase 6-9** : Bundling récursif, support des modules `node:` et transformation ESM -> CommonJS.
- [x] **Phase 10** : Intégration automatique des sources JS de Node.js (v26).

### En cours / À faire
- [ ] **Phase 11** : Fidélité des bindings `internalBinding` (fs, util, buffer) pour faire passer le code officiel de Node.
- [ ] **Phase 12** : Implémentation réelle des syscalls (lecture/écriture disque) dans les bindings Rust.
- [ ] **Phase 13** : Support complet des `node_modules` installés localement.
