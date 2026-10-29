# Where `src/jpeg` comes from

`src/jpeg` is a translation to Rust, by the Bun contributors in 2026, of parts of libjpeg-turbo 3.2.0
(<https://github.com/libjpeg-turbo/libjpeg-turbo>, commit c85e6b905bf237038faa936dab160ebfc5da0344). None of the files
is an unmodified copy. [LICENSE.md](LICENSE.md) and [README.ijg](README.ijg) are libjpeg-turbo's, unaltered, and apply.

This software is based in part on the work of the Independent JPEG Group.

The same goes for `src/jsc/bindings/highway_jpeg.cpp`, which has color conversion, downsampling and upsampling in C++.

Upstream's history was checked for fixes up to 7b499378 (2026-10-26), 57 commits after 3.2.0.

Most Rust modules name the files they derive from in the description at their top. The full list is below. Under each
file is the part of its header that says whose it is, word for word.

## The IJG License

After these lines each header says: "For conditions of distribution and use, see the accompanying README.ijg file."

```
src/jdapimin.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1998, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2016, 2022, 2024-2025, D. R. Commander.

src/jdapistd.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2010, 2015-2020, 2022-2026, D. R. Commander.
  Copyright (C) 2015, Google, Inc.

src/jdmaster.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Modified 2002-2009 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2009-2011, 2016, 2019, 2022-2024, 2026, D. R. Commander.
  Copyright (C) 2013, Linaro Limited.
  Copyright (C) 2015, Google, Inc.

src/jdinput.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2010, 2016, 2018, 2022, 2024, D. R. Commander.
  Copyright (C) 2015, Google, Inc.

src/jdmarker.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1998, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2012, 2015, 2022, 2024, 2026, D. R. Commander.

src/jdicc.c
  Copyright (C) 1997-1998, Thomas G. Lane, Todd Newman.
  Copyright (C) 2017, D. R. Commander.

src/jdhuff.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2009-2011, 2016, 2018-2019, 2022, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.

src/jdhuff.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2010-2011, 2015-2016, 2021, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.

src/jdphuff.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1995-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2015-2016, 2018-2022, D. R. Commander.

src/jdarith.c
  This file was part of the Independent JPEG Group's software:
  Developed 1997-2015 by Guido Vollbeding.
  libjpeg-turbo Modifications:
  Copyright (C) 2015-2020, 2022, D. R. Commander.

src/jaricom.c
  This file was part of the Independent JPEG Group's software:
  Developed 1997-2009 by Guido Vollbeding.
  libjpeg-turbo Modifications:
  Copyright (C) 2015, 2018, D. R. Commander.

src/jdlhuff.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, D. R. Commander.

src/jdlossls.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1998, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2024, 2026, D. R. Commander.

src/jlossls.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1998, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, D. R. Commander.

src/jddiffct.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2024, D. R. Commander.

src/jdcoefct.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1997, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2010, 2015-2016, 2019-2020, 2022-2026, D. R. Commander.
  Copyright (C) 2015, 2020, Google, Inc.

src/jdcoefct.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1997, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2020, Google, Inc.
  Copyright (C) 2022, D. R. Commander.

src/jddctmgr.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  Modified 2002-2010 by Guido Vollbeding.
  libjpeg-turbo Modifications:
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2010, 2015, 2022, 2025-2026, D. R. Commander.

src/jidctint.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1998, Thomas G. Lane.
  Modification developed 2002-2018 by Guido Vollbeding.
  libjpeg-turbo Modifications:
  Copyright (C) 2015, 2020, 2022, 2026, D. R. Commander.

src/jidctred.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1998, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2015, 2022, 2026, D. R. Commander.

src/jdsample.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2010, 2015-2016, 2022, 2024-2026, D. R. Commander.
  Copyright (C) 2015, Google, Inc.
  Copyright (C) 2019-2020, Arm Limited.

src/jdsample.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2026, D. R. Commander.

src/jdcolor.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Modified 2011 by Guido Vollbeding.
  libjpeg-turbo Modifications:
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2011-2012, 2014-2015, 2022, 2024-2025, D. R. Commander.
  Copyright (C) 2013, Linaro Limited.

src/jdcolext.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2009, 2011, 2015, 2022-2023, 2025, D. R. Commander.

src/jdmainct.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2010, 2016, 2022, 2024, 2026, D. R. Commander.

src/jdpostct.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2022-2024, D. R. Commander.

src/jdatasrc-tj.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  Modified 2009-2011 by Guido Vollbeding.
  libjpeg-turbo Modifications:
  Copyright (C) 2011, 2016, 2019, 2023, D. R. Commander.

src/jutils.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, D. R. Commander.

src/jstdhuff.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1998, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2013, 2022, 2024, D. R. Commander.

src/jcomapi.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1997, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2024-2026, D. R. Commander.

src/jerror.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1997, Thomas G. Lane.
  Modified 1997-2009 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2014, 2017, 2021-2023, 2026, D. R. Commander.

src/jpeglib.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1998, Thomas G. Lane.
  Modified 2002-2009 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2009-2011, 2013-2014, 2016-2017, 2020, 2022-2024,
            D. R. Commander.
  Copyright (C) 2015, Google, Inc.

src/jpegint.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Modified 1997-2009 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2015-2017, 2019, 2021-2022, 2024-2026, D. R. Commander.
  Copyright (C) 2015, Google, Inc.
  Copyright (C) 2021, Alex Richardson.

src/jmorecfg.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Modified 1997-2009 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2009, 2011, 2014-2015, 2018, 2020, 2022, 2026,
            D. R. Commander.

src/jdct.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2015, 2022, 2025, D. R. Commander.

src/jcapimin.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1998, Thomas G. Lane.
  Modified 2003-2010 by Guido Vollbeding.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2024-2025, D. R. Commander.

src/jcapistd.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2024, D. R. Commander.

src/jcparam.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1998, Thomas G. Lane.
  Modified 2003-2008 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2009-2011, 2018, 2023-2024, D. R. Commander.

src/jcmaster.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Modified 2003-2010 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2010, 2016, 2018, 2022-2024, 2026, D. R. Commander.

src/jcmarker.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1998, Thomas G. Lane.
  Modified 2003-2010 by Guido Vollbeding.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2010, 2022, D. R. Commander.

src/jcicc.c
  Copyright (C) 1997-1998, Thomas G. Lane, Todd Newman.
  Copyright (C) 2017, D. R. Commander.

src/jcmainct.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2024, D. R. Commander.

src/jcprepct.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2024-2026, D. R. Commander.

src/jccolor.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009-2012, 2015, 2022, 2024-2025, D. R. Commander.

src/jccolext.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2009-2012, 2015, 2022, 2025, D. R. Commander.

src/jcsample.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1996, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2015, 2019, 2022, 2024-2026, D. R. Commander.

src/jccoefct.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1997, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2024-2025, D. R. Commander.

src/jcdctmgr.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1994-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 1999-2006, MIYASAKA Masaru.
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2011, 2014-2015, 2022, 2024-2026, D. R. Commander.

src/jfdctint.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1996, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2015, 2020, 2022, D. R. Commander.

src/jchuff.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2009-2011, 2014-2016, 2018-2026, D. R. Commander.
  Copyright (C) 2015, Matthieu Darbois.
  Copyright (C) 2018, Matthias Räncker.
  Copyright (C) 2020, Arm Limited.
  Copyright (C) 2022, Felix Hanau.

src/jchuff.h
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1991-1997, Thomas G. Lane.
  libjpeg-turbo Modifications:
  Copyright (C) 2022, 2025, D. R. Commander.

src/jcphuff.c
  This file was part of the Independent JPEG Group's software:
  Copyright (C) 1995-1997, Thomas G. Lane.
  Lossless JPEG Modifications:
  Copyright (C) 1999, Ken Murchison.
  libjpeg-turbo Modifications:
  Copyright (C) 2011, 2015, 2018, 2021-2022, 2024-2025, D. R. Commander.
  Copyright (C) 2016, 2018, 2022, Matthieu Darbois.
  Copyright (C) 2020, Arm Limited.
  Copyright (C) 2021, Alex Richardson.
```

## The Modified (3-clause) BSD License

After these lines each header has the text of the license, the same as in [LICENSE.md](LICENSE.md).

```
src/turbojpeg.c
  Copyright (C) 2009-2026 D. R. Commander
  Copyright (C) 2021 Alex Richardson

src/turbojpeg-mp.c
  Copyright (C) 2009-2026 D. R. Commander
```

## The zlib License

After these lines each header says: "For conditions of distribution and use, see copyright notice in jsimdext.inc"

```
simd/x86_64/jidctint-sse2.asm
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2016, 2020, 2024-2025, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.
  Copyright (C) 2023, Aliaksiej Kandracienka.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jidctint-avx2.asm
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2016, 2018, 2020, 2024-2025, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jidctred-sse2.asm
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2016, 2024-2025, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.
  Copyright (C) 2023, Aliaksiej Kandracienka.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jfdctint-sse2.asm
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2016, 2020, 2024-2025, D. R. Commander.
  Copyright (C) 2023, Aliaksiej Kandracienka.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jquanti-sse2.asm
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2016, 2024-2025, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jdcolor-sse2.asm
  Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2016, 2024, D. R. Commander.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jdcolext-sse2.asm
  Copyright 2009, 2012 Pierre Ossman <ossman@cendio.se> for Cendio AB
  Copyright (C) 2009, 2012, 2016, 2024-2025, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.
  Copyright (C) 2023, Aliaksiej Kandracienka.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jccolor-sse2.asm
  Copyright (C) 2009, 2016, 2024, D. R. Commander.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.

simd/x86_64/jccolext-sse2.asm
  Copyright (C) 2009, 2016, 2024-2025, D. R. Commander.
  Copyright (C) 2018, Matthias Räncker.
  Copyright (C) 2023, Aliaksiej Kandracienka.

  Based on the x86 SIMD extension for IJG JPEG library
  Copyright (C) 1999-2006, MIYASAKA Masaru.
```

The notice in `simd/nasm/jsimdext.inc`:

```
Copyright 2009 Pierre Ossman <ossman@cendio.se> for Cendio AB
Copyright (C) 2010, 2016, 2018-2019, 2024, D. R. Commander.
Copyright (C) 2018, Matthieu Darbois.
Copyright (C) 2018, Matthias Räncker.
Copyright (C) 2023, Aliaksiej Kandracienka.

Based on the x86 SIMD extension for IJG JPEG library - version 1.02

Copyright (C) 1999-2006, MIYASAKA Masaru.

This software is provided 'as-is', without any express or implied
warranty.  In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```
